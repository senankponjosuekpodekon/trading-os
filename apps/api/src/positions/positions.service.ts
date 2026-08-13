import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { rlsContext } from '../prisma/rls-context';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalService } from '../journal/journal.service';
import { AuditService } from '../audit/audit.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { engineHeaders } from '../utils/engine-headers.util';
import { SystemHealthService } from '../system-health/system-health.service';
import { CrossPositionRiskService } from './cross-position-risk.service';

const BINANCE_TICKER = 'https://api.binance.com/api/v3/ticker/price';
const SYM_MAP: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT',
  'SOL/USDT': 'SOLUSDT', 'BNB/USDT': 'BNBUSDT',
};

type TrailingMethod = 'atr' | 'swing' | 'ema' | 'chandelier';

@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);
  private readonly engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private systemPrisma: PrismaSystemService,
    private http: HttpService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private journal: JournalService,
    private audit: AuditService,
    private health: SystemHealthService,
    private crossRisk: CrossPositionRiskService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  // Runs `fn` inside a single Postgres transaction, manually re-injecting the
  // current RLS user context first. Needed because the multi-statement
  // atomic updates below (position + portfolio together) use Prisma's
  // interactive transaction form, whose `tx` handle is the RAW client — it
  // does not go through the RLS-enforcing Proxy from prisma-rls.extension.ts
  // (that Proxy only wraps single, non-batched calls on `this.prisma`).
  private rlsTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const userId = rlsContext.getStore();
    return this.prisma.$transaction(async (tx) => {
      if (userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      }
      return fn(tx);
    });
  }

  private async fetchLivePrice(symbol: string): Promise<number | null> {
    // 1. Fast path: Binance ticker for known pairs
    const binSym = SYM_MAP[symbol];
    if (binSym) {
      try {
        const { data } = await firstValueFrom(
          this.http.get<{ price: string }>(BINANCE_TICKER, { params: { symbol: binSym } }),
        );
        return parseFloat(data.price);
      } catch {
        // fall through to engine
      }
    }
    // 2. Fallback: engine /candles endpoint (multi-provider: deriv, twelvedata, yfinance)
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ candles: Array<{ close: number }> }>(
          `${this.engineUrl}/candles/${encodeURIComponent(symbol)}`,
          { params: { timeframe: '1m', limit: 50 }, headers: engineHeaders(this.config) },
        ),
      );
      if (data.candles && data.candles.length > 0) {
        return parseFloat(String(data.candles[data.candles.length - 1].close));
      }
      return null;
    } catch {
      return null;
    }
  }

  private async fetchEngineKlines(symbol: string, interval = '1h', limit = 100) {
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ klines: any[] }>(`${this.engineUrl}/indicators/klines`, {
          params: { symbol, interval, limit },
          headers: engineHeaders(this.config),
        }),
      );
      return data.klines || [];
    } catch (e: any) {
      this.logger.warn(`fetchEngineKlines failed for ${symbol}: ${e?.message}`);
      return [];
    }
  }

  private async computeTrailingStopFromEngine(
    symbol: string,
    direction: 'BUY' | 'SELL',
    entryPrice: number,
    stopLoss: number,
    method: TrailingMethod,
    candles: any[],
  ): Promise<{ recommendedStop: number | null; activated: boolean; reason: string } | null> {
    if (!candles.length) return null;
    try {
      const payload = {
        symbol,
        direction,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        candles,
        method,
        activation_r: 0,
      };
      const { data } = await firstValueFrom(
        this.http.post(`${this.engineUrl}/trailing-stop/compute`, payload, { headers: engineHeaders(this.config) }),
      );
      return {
        recommendedStop: data.recommended_stop ?? null,
        activated: data.activated ?? true,
        reason: data.reason ?? '',
      };
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e?.response?.data?.message;
      this.logger.warn('compute_trailing_stop_failed', {
        symbol,
        status,
        error: e?.message,
        detail,
      });
      if (status === 400) {
        throw new BadRequestException(`Trailing stop invalide: ${detail ?? 'payload rejected by engine'}`);
      }
      return null;
    }
  }

  async create(userId: string, dto: CreatePositionDto) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: dto.portfolioId, userId },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    const asset = await this.prisma.asset.findUnique({ where: { symbol: dto.assetSymbol } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetSymbol} not found`);

    const cost = dto.entryPrice * dto.quantity;
    const capital = parseFloat(portfolio.currentCapital.toString());
    if (cost > capital) throw new BadRequestException('Insufficient capital');

    const initialCapital = parseFloat((portfolio as any).initialCapital?.toString() ?? '0');
    if (initialCapital > 0 && ((initialCapital - capital) / initialCapital) > 0.10) {
      throw new BadRequestException('Drawdown guard: portfolio drawdown exceeds 10%');
    }

    if (dto.stopLoss != null && dto.takeProfit != null) {
      const slDist = Math.abs(dto.entryPrice - dto.stopLoss);
      const tpDist = Math.abs(dto.takeProfit - dto.entryPrice);
      if (slDist > 0 && tpDist / slDist < 1.0) {
        throw new BadRequestException('RR_TOO_LOW');
      }
    }

    const duplicate = await this.prisma.position.findFirst({
      where: {
        portfolioId: dto.portfolioId,
        assetId: asset.id,
        status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] },
      },
    });
    if (duplicate) throw new ConflictException('DUPLICATE_POSITION');

    // Phase G — Cross-position correlation risk
    await this.crossRisk.checkCorrelationRisk(dto.portfolioId, asset.symbol, dto.direction as 'BUY' | 'SELL');

    const position = await this.rlsTransaction(async (tx) => {
      const created = await tx.position.create({
        data: {
          portfolioId: dto.portfolioId,
          assetId: asset.id,
          direction: dto.direction as any,
          entryPrice: dto.entryPrice,
          quantity: dto.quantity,
          originalQuantity: dto.quantity,
          stopLoss: dto.stopLoss,
          takeProfit: dto.takeProfit,
          takeProfit2: dto.takeProfit2 ?? null,
          takeProfit3: dto.takeProfit3 ?? null,
          trailingStop: dto.stopLoss,
          trailingMethod: dto.trailingMethod ?? 'atr',
          trailingActive: dto.trailingActive ?? true,
          signalId: dto.signalId,
          status: 'OPEN',
        },
        include: { asset: { select: { symbol: true, name: true } } },
      });
      await tx.portfolio.update({
        where: { id: dto.portfolioId },
        data: { currentCapital: { decrement: cost } },
      });
      return created;
    });

    await this.audit.log({
      userId,
      action: 'POSITION_OPEN',
      resource: 'position',
      details: { positionId: position.id, symbol: asset.symbol, direction: dto.direction, entryPrice: dto.entryPrice },
    });

    // Notify risk engine of new open position
    this._notifyRiskEngine('register-position', { symbol: asset.symbol, direction: dto.direction }).catch(() => {});

    return position;
  }

  private async _notifyRiskEngine(path: string, body: Record<string, unknown>): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.engineUrl}/risk/${path}`, body, {
          headers: engineHeaders(this.config),
        }),
      );
    } catch (e: any) {
      this.logger.warn(`Risk engine sync failed (${path}): ${e?.message}`);
    }
  }

  async findByPortfolio(
    userId: string,
    portfolioId: string,
    opts: { page: number; limit: number; sort?: string; status?: string } = { page: 1, limit: 20, sort: 'openedAt:desc' },
  ) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: portfolioId, userId },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    const [field, dir] = (opts.sort || 'openedAt:desc').split(':');
    const orderByField = ['openedAt', 'closedAt', 'createdAt', 'entryPrice'].includes(field) ? field : 'openedAt';
    const orderBy: any = { [orderByField]: dir === 'asc' ? 'asc' : 'desc' };
    const skip = (opts.page - 1) * opts.limit;

    const where: any = { portfolioId };
    if (opts.status) where.status = opts.status;

    const [data, total] = await Promise.all([
      this.prisma.position.findMany({
        where,
        skip,
        take: opts.limit,
        orderBy,
        include: { asset: { select: { symbol: true, name: true } } },
      }),
      this.prisma.position.count({ where }),
    ]);

    return {
      data,
      meta: { page: opts.page, limit: opts.limit, total, totalPages: Math.ceil(total / opts.limit) },
    };
  }

  async close(userId: string, positionId: string, exitPrice: number) {
    const position = await this.prisma.position.findFirst({
      where: { id: positionId, status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] }, portfolio: { userId } },
      include: { portfolio: true, asset: { select: { symbol: true } } },
    });
    if (!position) throw new NotFoundException('Position not found or already closed');

    const entry  = parseFloat(position.entryPrice.toString());
    const qty    = parseFloat(position.quantity.toString());
    const originalQty = position.originalQuantity
      ? parseFloat(position.originalQuantity.toString())
      : qty;
    const realizedPartial = position.partialPnl
      ? parseFloat(position.partialPnl.toString())
      : 0;
    const realizedSecondPartial = position.secondPartialPnl
      ? parseFloat(position.secondPartialPnl.toString())
      : 0;
    const pnlOnRemaining = position.direction === 'BUY'
      ? (exitPrice - entry) * qty
      : (entry - exitPrice) * qty;
    const pnl = realizedPartial + realizedSecondPartial + pnlOnRemaining;
    const pnlPct = originalQty > 0 ? ((pnl / (entry * originalQty)) * 100) : 0;
    const proceeds = exitPrice * qty;

    await this.rlsTransaction(async (tx) => {
      await tx.position.update({
        where: { id: positionId },
        data: {
          status: 'CLOSED',
          exitPrice,
          pnl,
          pnlPercent: pnlPct,
          closedAt: new Date(),
        },
      });
      await tx.portfolio.update({
        where: { id: position.portfolioId },
        data: { currentCapital: { increment: proceeds } },
      });
    });

    try {
      await this.journal.createAuto({
        userId,
        assetSymbol: position.asset.symbol,
        direction: position.direction,
        entryPrice: entry,
        exitPrice,
        pnl,
        pnlPct,
        closeReason: 'MANUAL',
        positionId,
      });
    } catch {
      this.logger.warn(`Journal auto failed for manual close ${positionId}`);
    }

    await this.audit.log({
      userId,
      action: 'POSITION_CLOSE',
      resource: 'position',
      details: { positionId, symbol: position.asset?.symbol, exitPrice, pnl },
    });

    // Sync risk engine with realized PnL + updated capital
    const updatedCapital = parseFloat(position.portfolio.currentCapital.toString()) + proceeds;
    this._notifyRiskEngine('record-trade', { pnl, symbol: position.asset?.symbol, direction: position.direction }).catch(() => {});
    this._notifyRiskEngine('update-capital', { current_capital: updatedCapital }).catch(() => {});

    return { positionId, exitPrice, pnl: pnl.toFixed(2), pnlPercent: pnlPct.toFixed(2) };
  }

  async getSummary(userId: string, portfolioId?: string) {
    let resolvedId = portfolioId;
    if (!resolvedId || resolvedId === 'ALL') {
      const first = await this.prisma.portfolio.findFirst({ where: { userId } });
      if (!first) return { open: 0, closed: 0, totalPnl: 0, winRate: 0, positions: [] };
      resolvedId = first.id;
    }
    const { data: positions } = await this.findByPortfolio(userId, resolvedId!, { page: 1, limit: 10_000, sort: 'openedAt:desc' });
    const open   = positions.filter(p => p.status === 'OPEN' || p.status === 'PARTIAL' || p.status === 'PARTIAL_2');
    const closed = positions.filter(p => p.status === 'CLOSED');
    const totalPnl = closed.reduce((sum, p) => sum + parseFloat((p.pnl ?? 0).toString()), 0);
    const winRate  = closed.length > 0
      ? (closed.filter(p => parseFloat((p.pnl ?? 0).toString()) > 0).length / closed.length) * 100
      : 0;

    return { open: open.length, closed: closed.length, totalPnl, winRate, positions };
  }

  async getLivePositions(userId: string, portfolioId?: string) {
    let resolvedId = portfolioId;
    if (!resolvedId || resolvedId === 'ALL') {
      const first = await this.prisma.portfolio.findFirst({ where: { userId } });
      if (!first) return [];
      resolvedId = first.id;
    }

    const openPositions = await this.prisma.position.findMany({
      where: { portfolioId: resolvedId, status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] }, portfolio: { userId } },
      include: { asset: { select: { symbol: true, name: true } } },
      orderBy: { openedAt: 'desc' },
    });

    const withLive = await Promise.all(
      openPositions.map(async (pos) => {
        const livePrice = await this.fetchLivePrice(pos.asset.symbol);
        if (!livePrice) return { ...pos, livePrice: null, unrealizedPnl: null, unrealizedPct: null };

        const entry = parseFloat(pos.entryPrice.toString());
        const qty   = parseFloat(pos.quantity.toString());
        const unrealizedPnl = pos.direction === 'BUY'
          ? (livePrice - entry) * qty
          : (entry - livePrice) * qty;
        const unrealizedPct = (unrealizedPnl / (entry * qty)) * 100;

        return {
          ...pos,
          livePrice,
          unrealizedPnl: parseFloat(unrealizedPnl.toFixed(2)),
          unrealizedPct: parseFloat(unrealizedPct.toFixed(2)),
          slDistance:    pos.stopLoss   ? Math.abs(livePrice - parseFloat(pos.stopLoss.toString())) : null,
          tpDistance:    pos.takeProfit ? Math.abs(parseFloat(pos.takeProfit.toString()) - livePrice) : null,
        };
      }),
    );

    return withLive;
  }

  private async getOrCreatePaperPortfolio(userId: string) {
    let portfolio = await this.prisma.portfolio.findFirst({
      where: { userId, type: 'PAPER' },
    });
    if (!portfolio) {
      portfolio = await this.prisma.portfolio.create({
        data: { userId, name: 'Paper Trading', type: 'PAPER', currency: 'USD' },
      });
    }
    return portfolio;
  }

  // ── Execution Gate ──────────────────────────────────────────────
  // Validates that a signal is still executable at the current live price.
  // Checks: expiration, entry zone, SL/TP coherence, minimum R:R.
  // MIN_RR is warn-only initially — logs but does not block.
  private _validateExecutionGate(
    signal: any,
    livePrice: number,
    portfolioType: 'PAPER' | 'LIVE',
  ): { ok: boolean; reason?: string; zone?: { lower: number; upper: number; optimal: number } } {
    const MIN_RR = 1.0;
    const MIN_RR_BLOCK = 1.5;
    const isBuy = signal.signal === 'BUY';
    const signalEntry = signal.entryPrice ? parseFloat(signal.entryPrice.toString()) : null;
    const sl = signal.stopLoss ? parseFloat(signal.stopLoss.toString()) : null;
    const tp1 = signal.takeProfit1 ? parseFloat(signal.takeProfit1.toString()) : null;

    // 1. Expiration check
    if (signal.expiresAt && new Date(signal.expiresAt) < new Date()) {
      this.logger.warn(
        `GATE REJECT [EXPIRED] signal=${signal.id} symbol=${signal.asset?.symbol} ` +
        `expiresAt=${signal.expiresAt} now=${new Date().toISOString()} ` +
        `tf=${signal.timeframe} type=${portfolioType}`,
      );
      return { ok: false, reason: `Signal expired at ${signal.expiresAt}` };
    }

    if (!signalEntry || !sl || !tp1) {
      // Not enough data to gate — allow through but log
      this.logger.warn(
        `GATE SKIP [MISSING_DATA] signal=${signal.id} ` +
        `entry=${signalEntry} sl=${sl} tp1=${tp1} type=${portfolioType}`,
      );
      return { ok: true };
    }

    // 2. Compute entry zone from SL, TP1, MIN_RR
    //    Zone lower bound = signalEntry - ATR_noise (adverse side)
    //    Zone upper bound derived from MIN_RR: maxEntry such that R:R >= MIN_RR
    //    For BUY: R:R = (tp1 - entry) / (entry - sl) >= MIN_RR
    //      => entry <= tp1 - MIN_RR * (signalEntry - sl)  [upper bound from TP1]
    //      => entry >= sl + (tp1 - signalEntry) / MIN_RR  [lower bound from SL coherence]
    //    For SELL: mirrored
    const slDist = Math.abs(signalEntry - sl);
    const tpDist = Math.abs(tp1 - signalEntry);
    const noiseFloor = slDist * 0.15; // 15% of SL distance as noise tolerance

    let zoneLower: number, zoneUpper: number;
    if (isBuy) {
      zoneLower = signalEntry - noiseFloor;
      zoneUpper = sl + tpDist / MIN_RR; // max entry where R:R >= MIN_RR
      // Also cap upper bound at signalEntry + noiseFloor (don't accept too favorable either)
      zoneUpper = Math.min(zoneUpper, signalEntry + noiseFloor);
    } else {
      zoneLower = sl - tpDist / MIN_RR;
      zoneLower = Math.max(zoneLower, signalEntry - noiseFloor);
      zoneUpper = signalEntry + noiseFloor;
    }

    const zone = { lower: zoneLower, upper: zoneUpper, optimal: (zoneLower + zoneUpper) / 2 };

    // 3. Validate livePrice within entry zone
    if (livePrice < zoneLower || livePrice > zoneUpper) {
      this.logger.warn(
        `GATE REJECT [OUT_OF_ZONE] signal=${signal.id} symbol=${signal.asset?.symbol} ` +
        `livePrice=${livePrice} zone=[${zoneLower.toFixed(6)}, ${zoneUpper.toFixed(6)}] ` +
        `signalEntry=${signalEntry} sl=${sl} tp1=${tp1} ` +
        `isBuy=${isBuy} type=${portfolioType}`,
      );
      return { ok: false, reason: `Price ${livePrice} outside entry zone [${zoneLower.toFixed(4)}, ${zoneUpper.toFixed(4)}]`, zone };
    }

    // 4. SL/TP coherence relative to livePrice
    if (isBuy && livePrice >= sl) {
      this.logger.warn(
        `GATE REJECT [SL_ABOVE_ENTRY] signal=${signal.id} livePrice=${livePrice} sl=${sl} type=${portfolioType}`,
      );
      return { ok: false, reason: `Live price ${livePrice} is at or above stop loss ${sl} for BUY`, zone };
    }
    if (!isBuy && livePrice <= sl) {
      this.logger.warn(
        `GATE REJECT [SL_BELOW_ENTRY] signal=${signal.id} livePrice=${livePrice} sl=${sl} type=${portfolioType}`,
      );
      return { ok: false, reason: `Live price ${livePrice} is at or below stop loss ${sl} for SELL`, zone };
    }

    // 5. R:R check at livePrice (warn-only for now)
    const liveRR = isBuy
      ? (tp1 - livePrice) / (livePrice - sl)
      : (livePrice - tp1) / (sl - livePrice);

    if (liveRR < MIN_RR_BLOCK) {
      this.logger.warn(
        `GATE WARN [LOW_RR] signal=${signal.id} symbol=${signal.asset?.symbol} ` +
        `liveRR=${liveRR.toFixed(2)} threshold=${MIN_RR_BLOCK} ` +
        `livePrice=${livePrice} sl=${sl} tp1=${tp1} type=${portfolioType}`,
      );
      // Warn-only: do not block yet
    }

    this.logger.log(
      `GATE PASS signal=${signal.id} symbol=${signal.asset?.symbol} ` +
      `livePrice=${livePrice} zone=[${zoneLower.toFixed(6)}, ${zoneUpper.toFixed(6)}] ` +
      `liveRR=${liveRR.toFixed(2)} type=${portfolioType}`,
    );

    return { ok: true, zone };
  }

  async checkGate(signalId: string, livePrice?: number) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { asset: true },
    });
    if (!signal) throw new NotFoundException('Signal not found');

    const signalEntry = signal.entryPrice ? parseFloat(signal.entryPrice.toString()) : null;
    const price = livePrice ?? signalEntry;
    if (!price) {
      return { signalId, valid: false, reason: 'No entry price available', zone: null };
    }

    const result = this._validateExecutionGate(signal, price, 'PAPER');
    return {
      signalId,
      symbol: signal.asset?.symbol,
      signal: signal.signal,
      valid: result.ok,
      reason: result.reason ?? null,
      zone: result.zone ?? null,
      livePrice: price,
      signalEntry,
      expiresAt: signal.expiresAt,
      timeframe: signal.timeframe,
    };
  }

  async openFromSignal(userId: string, signalId: string, portfolioType: 'PAPER' | 'LIVE' = 'PAPER', livePrice?: number) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { asset: true },
    });
    if (!signal) throw new NotFoundException('Signal not found');
    if (signal.signal === 'NEUTRAL') throw new BadRequestException('Cannot open position on NEUTRAL signal');

    const portfolio = portfolioType === 'PAPER'
      ? await this.getOrCreatePaperPortfolio(userId)
      : await this.prisma.portfolio.findFirst({ where: { userId, type: 'LIVE' } });
    if (!portfolio) throw new NotFoundException('No portfolio found');

    // Anti-doublon: même garde-fou que create()
    const duplicate = await this.prisma.position.findFirst({
      where: {
        portfolioId: portfolio.id,
        assetId: signal.assetId,
        status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] },
      },
    });
    if (duplicate) throw new ConflictException('DUPLICATE_POSITION');

    // Phase G — Cross-position correlation risk
    await this.crossRisk.checkCorrelationRisk(portfolio.id, signal.asset.symbol, signal.signal as 'BUY' | 'SELL');

    const capital    = parseFloat(portfolio.currentCapital.toString());
    const riskPct    = 0.01;  // 1% risque par défaut
    // Quality-based sizing: reduce position size for lower-quality signals
    const qualityMultiplier = (signal as any).metadata?.quality_size_multiplier
      ? parseFloat((signal as any).metadata.quality_size_multiplier)
      : 1.0;
    const riskAmt    = capital * riskPct * qualityMultiplier;
    // Paper trading: utiliser le prix live du marché si fourni (norme: prix au moment du clic, pas au moment du signal)
    // Live trading: utiliser le prix du signal (l'exchange exécutera au prix réel du marché)
    const signalEntry = signal.entryPrice ? parseFloat(signal.entryPrice.toString()) : null;
    const entryPrice = portfolioType === 'PAPER' && livePrice
      ? livePrice
      : signalEntry;
    if (!entryPrice) throw new BadRequestException('Signal has no entry price and no live price provided');

    // ── Execution Gate: validate signal is still executable at current price ──
    const gateResult = this._validateExecutionGate(signal, entryPrice, portfolioType);
    if (!gateResult.ok) {
      throw new BadRequestException(`Execution gate rejected: ${gateResult.reason}`);
    }

    const slPrice = signal.stopLoss ? parseFloat(signal.stopLoss.toString()) : null;
    const slDist  = slPrice ? Math.abs(entryPrice - slPrice) : entryPrice * 0.015;

    // Sizing par SL-distance (méthode standard)
    let qty = parseFloat((riskAmt / slDist).toFixed(6));
    let cost = entryPrice * qty;

    // Safety cap : le coût ne peut pas dépasser 20% du capital disponible.
    // Se produit quand le SL est très serré (slDist petite -> qty explose).
    // Dans ce cas on redimensionne la position sur la limite de coût.
    const MAX_COST_RATIO = 0.20;
    if (cost > capital * MAX_COST_RATIO) {
      cost = capital * MAX_COST_RATIO;
      qty  = parseFloat((cost / entryPrice).toFixed(6));
    }

    if (cost > capital) throw new BadRequestException(
      `Capital insuffisant : coût estimé $${cost.toFixed(2)} > capital disponible $${capital.toFixed(2)}`
    );

    const position = await this.rlsTransaction(async (tx) => {
      const created = await tx.position.create({
        data: {
          portfolioId: portfolio.id,
          assetId:     signal.assetId,
          direction:   signal.signal as any,
          entryPrice,
          quantity:    qty,
          originalQuantity: qty,
          stopLoss:    slPrice,
          takeProfit:  signal.takeProfit1 ? parseFloat(signal.takeProfit1.toString()) : null,
          takeProfit2: signal.takeProfit2 ? parseFloat(signal.takeProfit2.toString()) : null,
          takeProfit3: (signal as any).takeProfit3 ? parseFloat((signal as any).takeProfit3.toString()) : null,
          trailingStop: slPrice,
          signalId,
          status:      'OPEN',
        },
        include: { asset: { select: { symbol: true, name: true } } },
      });
      await tx.portfolio.update({
        where: { id: portfolio.id },
        data:  { currentCapital: { decrement: cost } },
      });
      return created;
    });

    this.notifications.push({
      userId,
      type:    'POSITION',
      title:   `Position ouverte — ${position.asset.symbol}`,
      message: `${signal.signal} ${qty} @ $${entryPrice} | SL: $${slPrice ?? '—'} | TP1: $${signal.takeProfit1 ?? '—'} | TP2: $${signal.takeProfit2 ?? '—'}`,
      data:    position,
    });

    return position;
  }

  @Cron('*/30 * * * * *')
  async syncTrailingStops() {
    try {
      this.logger.log('TRAILING: synchronisation des trailing stops');
      const open = await this.systemPrisma.position.findMany({
        where: { status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] } },
        include: {
          asset: { select: { symbol: true } },
          portfolio: { select: { userId: true } },
          signal: { select: { indicators: true, timeframe: true } },
        },
      });

      for (const pos of open) {
        try {
          await rlsContext.run(pos.portfolio.userId, () => this._syncOneTrailingStop(pos));
        } catch (e: any) {
          this.logger.warn(`syncTrailingStops failed for ${pos.asset.symbol}: ${e?.message}`);
        }
      }
      this.health.recordCronRun('sync-trailing-stops', 'ok');
    } catch (e: any) {
      this.health.recordCronRun('sync-trailing-stops', 'error', e?.message);
    }
  }

  private async _syncOneTrailingStop(pos: any) {
        const price = await this.fetchLivePrice(pos.asset.symbol);
        if (!price) return;

        const entry = parseFloat(pos.entryPrice.toString());
        const sl = pos.stopLoss ? parseFloat(pos.stopLoss.toString()) : null;
        const tp1 = pos.takeProfit ? parseFloat(pos.takeProfit.toString()) : null;
        const tp2 = pos.takeProfit2 ? parseFloat(pos.takeProfit2.toString()) : null;
        const tp3 = pos.takeProfit3 ? parseFloat(pos.takeProfit3.toString()) : null;
        let trailingStop = pos.trailingStop
          ? parseFloat(pos.trailingStop.toString())
          : (sl ?? (pos.direction === 'BUY' ? entry * 0.99 : entry * 1.01));

        // Handle 3-tier TP lifecycle: OPEN → PARTIAL (50%@TP1) → PARTIAL_2 (30%@TP2) → CLOSED (20%@TP3 or trailing)
        if (pos.direction === 'BUY') {
          // TP1: OPEN → PARTIAL (close 50%)
          if (pos.status === 'OPEN' && tp1 && tp2 && price >= tp1) {
            await this.partialCloseByWatcher(pos.id, price);
            return;
          }
          // TP1 without TP2: full close
          if (pos.status === 'OPEN' && tp1 && !tp2 && price >= tp1) {
            await this.closeByWatcher(pos.id, price, 'TP');
            return;
          }
          // TP2: PARTIAL → PARTIAL_2 (close 30% of original, i.e. 60% of remaining)
          if (pos.status === 'PARTIAL' && tp2 && price >= tp2) {
            if (tp3) {
              await this.secondPartialCloseByWatcher(pos.id, price);
              return;
            } else {
              // No TP3 — close the rest at TP2
              await this.closeByWatcher(pos.id, price, 'TP');
              return;
            }
          }
          // TP3: PARTIAL_2 → CLOSED (close remaining 20%)
          if (pos.status === 'PARTIAL_2' && tp3 && price >= tp3) {
            await this.closeByWatcher(pos.id, price, 'TP');
            return;
          }
        } else {
          if (pos.status === 'OPEN' && tp1 && tp2 && price <= tp1) {
            await this.partialCloseByWatcher(pos.id, price);
            return;
          }
          if (pos.status === 'OPEN' && tp1 && !tp2 && price <= tp1) {
            await this.closeByWatcher(pos.id, price, 'TP');
            return;
          }
          if (pos.status === 'PARTIAL' && tp2 && price <= tp2) {
            if (tp3) {
              await this.secondPartialCloseByWatcher(pos.id, price);
              return;
            } else {
              await this.closeByWatcher(pos.id, price, 'TP');
              return;
            }
          }
          if (pos.status === 'PARTIAL_2' && tp3 && price <= tp3) {
            await this.closeByWatcher(pos.id, price, 'TP');
            return;
          }
        }

        // Compute trailing stop: prefer engine multi-method, fallback to ATR
        if (pos.trailingActive !== false) {
          const method = (pos.trailingMethod as TrailingMethod) || 'atr';
          const interval = (pos.signal as any)?.timeframe || '1h';
          const candles = await this.fetchEngineKlines(pos.asset.symbol, interval, 100);
          const engineStop = candles.length
            ? await this.computeTrailingStopFromEngine(
                pos.asset.symbol,
                pos.direction as 'BUY' | 'SELL',
                entry,
                sl ?? (pos.direction === 'BUY' ? entry * 0.99 : entry * 1.01),
                method,
                candles,
              )
            : null;

          if (engineStop?.recommendedStop != null) {
            trailingStop = engineStop.recommendedStop;
          } else {
            const atrFallback = (pos.signal?.indicators as any)?.atr ?? entry * 0.01;
            if (pos.direction === 'BUY') {
              const newStop = price - atrFallback;
              if (newStop > trailingStop) trailingStop = newStop;
            } else {
              const newStop = price + atrFallback;
              if (newStop < trailingStop) trailingStop = newStop;
            }
          }
        }

        if (pos.direction === 'BUY' && price <= trailingStop) {
          await this.closeByWatcher(pos.id, price, 'TRAILING');
          return;
        }
        if (pos.direction === 'SELL' && price >= trailingStop) {
          await this.closeByWatcher(pos.id, price, 'TRAILING');
          return;
        }

        const currentStop = pos.trailingStop ? parseFloat(pos.trailingStop.toString()) : null;
        if (trailingStop !== currentStop) {
          await this.prisma.position.update({
            where: { id: pos.id },
            data: { trailingStop },
          });
        }
  }

  private async partialCloseByWatcher(positionId: string, exitPrice: number) {
    const pos = await this.prisma.position.findFirst({
      where: { id: positionId, status: 'OPEN' },
      include: { portfolio: { include: { user: true } }, asset: true },
    });
    if (!pos || !pos.takeProfit2) return null;

    const entry = parseFloat(pos.entryPrice.toString());
    const currentQty = parseFloat(pos.quantity.toString());
    const closeQty = parseFloat((currentQty / 2).toFixed(6));
    const remainingQty = parseFloat((currentQty - closeQty).toFixed(6));
    if (closeQty <= 0 || remainingQty <= 0) return null;

    const partialPnl = pos.direction === 'BUY'
      ? (exitPrice - entry) * closeQty
      : (entry - exitPrice) * closeQty;
    const proceeds = exitPrice * closeQty;

    const prevTrailing = pos.trailingStop
      ? parseFloat(pos.trailingStop.toString())
      : (pos.direction === 'BUY' ? entry * 0.99 : entry * 1.01);
    const breakevenTrail = pos.direction === 'BUY'
      ? Math.max(prevTrailing, entry)
      : Math.min(prevTrailing, entry);

    await this.rlsTransaction(async (tx) => {
      await tx.position.update({
        where: { id: positionId },
        data: {
          status: 'PARTIAL',
          quantity: remainingQty,
          stopLoss: entry,
          trailingStop: breakevenTrail,
          partialExitPrice: exitPrice,
          partialExitAt: new Date(),
          partialPnl,
        },
      });
      await tx.portfolio.update({
        where: { id: pos.portfolioId },
        data:  { currentCapital: { increment: proceeds } },
      });
    });

    this.notifications.push({
      userId: pos.portfolio.userId,
      type:    'POSITION',
      title:   `TP1 atteint — ${pos.asset.symbol}`,
      message: `50% clôturé à $${exitPrice}. Reste en ${pos.status} vers TP2.`,
      data:    { positionId, exitPrice, partialPnl, remainingQty, status: 'PARTIAL' },
    });

    return { positionId, exitPrice, partialPnl: partialPnl.toFixed(2), remainingQty };
  }

  private async secondPartialCloseByWatcher(positionId: string, exitPrice: number) {
    const pos = await this.prisma.position.findFirst({
      where: { id: positionId, status: 'PARTIAL' },
      include: { portfolio: { include: { user: true } }, asset: true },
    });
    if (!pos) return null;

    const entry = parseFloat(pos.entryPrice.toString());
    const currentQty = parseFloat(pos.quantity.toString());
    const originalQty = pos.originalQuantity
      ? parseFloat(pos.originalQuantity.toString())
      : currentQty;
    // Close 30% of original quantity (i.e. 60% of what remains after first 50% close)
    const closeQty = parseFloat((originalQty * 0.3).toFixed(6));
    const remainingQty = parseFloat((currentQty - closeQty).toFixed(6));
    if (closeQty <= 0 || remainingQty <= 0) {
      // Not enough left — close everything
      await this.closeByWatcher(positionId, exitPrice, 'TP');
      return null;
    }

    const partialPnl = pos.direction === 'BUY'
      ? (exitPrice - entry) * closeQty
      : (entry - exitPrice) * closeQty;
    const proceeds = exitPrice * closeQty;

    // Move trailing stop to lock more profit (above entry for BUY, below for SELL)
    const prevTrailing = pos.trailingStop
      ? parseFloat(pos.trailingStop.toString())
      : (pos.direction === 'BUY' ? entry * 0.99 : entry * 1.01);
    const tightenedTrail = pos.direction === 'BUY'
      ? Math.max(prevTrailing, exitPrice - (exitPrice - entry) * 0.3)
      : Math.min(prevTrailing, exitPrice + (entry - exitPrice) * 0.3);

    const firstPartialPnl = pos.partialPnl ? parseFloat(pos.partialPnl.toString()) : 0;

    await this.rlsTransaction(async (tx) => {
      await tx.position.update({
        where: { id: positionId },
        data: {
          status: 'PARTIAL_2',
          quantity: remainingQty,
          trailingStop: tightenedTrail,
          secondPartialExitPrice: exitPrice,
          secondPartialExitAt: new Date(),
          secondPartialPnl: partialPnl,
        },
      });
      await tx.portfolio.update({
        where: { id: pos.portfolioId },
        data: { currentCapital: { increment: proceeds } },
      });
    });

    this.notifications.push({
      userId: pos.portfolio.userId,
      type: 'POSITION',
      title: `TP2 atteint — ${pos.asset.symbol}`,
      message: `30% clôturé à $${exitPrice}. Reste 20% vers TP3 ou trailing.`,
      data: { positionId, exitPrice, partialPnl, remainingQty, status: 'PARTIAL_2' },
    });

    return { positionId, exitPrice, secondPartialPnl: partialPnl.toFixed(2), remainingQty };
  }

  async closeByWatcher(
    positionId: string,
    exitPrice: number,
    reason: 'SL' | 'TP' | 'TRAILING',
    opts?: { skipJournal?: boolean },
  ) {
    const pos = await this.prisma.position.findFirst({
      where: { id: positionId, status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] } },
      include: { portfolio: { include: { user: true } }, asset: true },
    });
    if (!pos) return null;

    const entry = parseFloat(pos.entryPrice.toString());
    const qty   = parseFloat(pos.quantity.toString());
    const originalQty = pos.originalQuantity
      ? parseFloat(pos.originalQuantity.toString())
      : qty;
    const realizedPartial = pos.partialPnl ? parseFloat(pos.partialPnl.toString()) : 0;
    const realizedSecondPartial = pos.secondPartialPnl ? parseFloat(pos.secondPartialPnl.toString()) : 0;
    const pnlOnRemaining = pos.direction === 'BUY'
      ? (exitPrice - entry) * qty
      : (entry - exitPrice) * qty;
    const pnl   = realizedPartial + realizedSecondPartial + pnlOnRemaining;
    const pnlPct = originalQty > 0 ? (pnl / (entry * originalQty)) * 100 : 0;

    await this.rlsTransaction(async (tx) => {
      await tx.position.update({
        where: { id: positionId },
        data: { status: 'CLOSED', exitPrice, pnl, pnlPercent: pnlPct, closedAt: new Date() },
      });
      await tx.portfolio.update({
        where: { id: pos.portfolioId },
        data:  { currentCapital: { increment: exitPrice * qty } },
      });
    });

    const userId = pos.portfolio.userId;

    if (!opts?.skipJournal) {
      try {
        await this.journal.createAuto({
          userId,
          assetSymbol: pos.asset.symbol,
          direction: pos.direction,
          entryPrice: entry,
          exitPrice,
          pnl,
          pnlPct,
          closeReason: reason,
          positionId,
        });
      } catch {
        this.logger.warn(`Journal auto failed for watcher close ${positionId}`);
      }
    }

    this.notifications.push({
      userId,
      type:    'POSITION',
      title:   `Position fermée (${reason}) — ${pos.asset.symbol}`,
      message: `PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
      data:    { positionId, exitPrice, pnl, reason },
    });

    // Sync risk engine with realized PnL + updated capital
    const updatedCapital = parseFloat(pos.portfolio.currentCapital.toString()) + (exitPrice * qty);
    this._notifyRiskEngine('record-trade', { pnl, symbol: pos.asset.symbol, direction: pos.direction }).catch(() => {});
    this._notifyRiskEngine('update-capital', { current_capital: updatedCapital }).catch(() => {});

    return { positionId, exitPrice, pnl: pnl.toFixed(2), pnlPercent: pnlPct.toFixed(2), reason };
  }

  async setTrailingStop(
    userId: string,
    positionId: string,
    opts: { method?: TrailingMethod; active?: boolean },
  ) {
    const pos = await this.prisma.position.findFirst({
      where: { id: positionId, portfolio: { userId } },
    });
    if (!pos) throw new NotFoundException('Position not found');

    const data: any = {};
    if (opts.method !== undefined) data.trailingMethod = opts.method;
    if (opts.active !== undefined) data.trailingActive = opts.active;

    return this.prisma.position.update({
      where: { id: positionId },
      data,
      include: { asset: { select: { symbol: true, name: true } } },
    });
  }

  async continuationAdvice(userId: string, positionId: string, currentPrice?: number) {
    const pos = await this.prisma.position.findFirst({
      where: { id: positionId, portfolio: { userId } },
      include: { asset: true, signal: true },
    });
    if (!pos) throw new NotFoundException('Position not found');
    if (pos.status !== 'OPEN' && pos.status !== 'PARTIAL') {
      throw new BadRequestException('Continuation advice only available for open positions');
    }

    const price = currentPrice ?? (await this.fetchLivePrice(pos.asset.symbol)) ?? parseFloat(pos.entryPrice.toString());
    const indicators = (pos.signal?.indicators as any) ?? {};
    const adx = indicators.adx ?? 25;

    const payload = {
      direction: pos.direction,
      price,
      entry: parseFloat(pos.entryPrice.toString()),
      tp1: pos.takeProfit ? parseFloat(pos.takeProfit.toString()) : price,
      tp2: pos.takeProfit2 ? parseFloat(pos.takeProfit2.toString()) : price,
      adx,
      structure_intact: true,
      volume_increasing: false,
      divergence_htf: false,
    };

    const { data } = await firstValueFrom(
      this.http.post(`${this.engineUrl}/probability/continuation`, payload, { headers: engineHeaders(this.config) }),
    );
    return data;
  }

  async pyramid(userId: string, positionId: string) {
    const parent = await this.prisma.position.findFirst({
      where: { id: positionId, portfolio: { userId } },
      include: { portfolio: true, asset: { select: { symbol: true } } },
    });
    if (!parent) throw new NotFoundException('Position not found');
    if (parent.status !== 'PARTIAL' && parent.status !== 'PARTIAL_2') {
      throw new BadRequestException('Pyramiding only allowed after TP1 (PARTIAL or PARTIAL_2 status)');
    }

    // Check no existing pyramid child
    const existingPyramid = await this.prisma.position.findFirst({
      where: { parentPositionId: positionId, status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] } },
    });
    if (existingPyramid) throw new ConflictException('PYRAMID_ALREADY_EXISTS');

    const price = await this.fetchLivePrice(parent.asset.symbol);
    if (!price) throw new BadRequestException('Cannot fetch live price for pyramiding');

    const originalQty = parent.originalQuantity
      ? parseFloat(parent.originalQuantity.toString())
      : parseFloat(parent.quantity.toString());
    const entry = parseFloat(parent.entryPrice.toString());

    // Pyramid size: 25% of original quantity
    const pyramidQty = parseFloat((originalQty * 0.25).toFixed(6));
    const cost = price * pyramidQty;

    const capital = parseFloat(parent.portfolio.currentCapital.toString());
    if (cost > capital * 0.15) {
      throw new BadRequestException('Insufficient capital for pyramid (max 15% of portfolio)');
    }
    if (cost > capital) {
      throw new BadRequestException('Insufficient capital for pyramid');
    }

    // SL at breakeven (entry price of parent) — risk-free add-on
    const pyramidSl = entry;
    // TP at parent's TP2 or TP3 (whichever is further)
    const pyramidTp1 = parent.takeProfit2 ? parseFloat(parent.takeProfit2.toString()) : null;
    const pyramidTp2 = parent.takeProfit3 ? parseFloat(parent.takeProfit3.toString()) : null;

    const child = await this.rlsTransaction(async (tx) => {
      const created = await tx.position.create({
        data: {
          portfolioId: parent.portfolioId,
          assetId: parent.assetId,
          parentPositionId: positionId,
          direction: parent.direction,
          entryPrice: price,
          quantity: pyramidQty,
          originalQuantity: pyramidQty,
          stopLoss: pyramidSl,
          takeProfit: pyramidTp1,
          takeProfit2: pyramidTp2,
          trailingStop: pyramidSl,
          trailingMethod: parent.trailingMethod ?? 'atr',
          trailingActive: true,
          signalId: parent.signalId,
          status: 'OPEN',
        },
        include: { asset: { select: { symbol: true, name: true } } },
      });
      await tx.portfolio.update({
        where: { id: parent.portfolioId },
        data: { currentCapital: { decrement: cost } },
      });
      return created;
    });

    this.notifications.push({
      userId,
      type: 'POSITION',
      title: `Pyramiding — ${parent.asset.symbol}`,
      message: `+25% ajouté à $${price} (SL au breakeven $${entry}). Position totale renforcée.`,
      data: { parentPositionId: positionId, childPositionId: child.id, pyramidQty, entryPrice: price },
    });

    await this.audit.log({
      userId,
      action: 'POSITION_PYRAMID',
      resource: 'position',
      details: { parentPositionId: positionId, childPositionId: child.id, symbol: parent.asset.symbol, pyramidQty, entryPrice: price },
    });

    return { parentPositionId: positionId, childPositionId: child.id, pyramidQty, entryPrice: price };
  }
}
