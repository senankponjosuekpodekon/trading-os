import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { rlsContext } from '../prisma/rls-context';
import { PositionsService } from '../positions/positions.service';
import { JournalService } from '../journal/journal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceAlertsService } from '../price-alerts/price-alerts.service';
import { retryWithBackoff } from '../utils/retry';
import { engineHeaders } from '../utils/engine-headers.util';
import { SystemHealthService } from '../system-health/system-health.service';

const BINANCE_PRICES = 'https://api.binance.com/api/v3/ticker/price';
const SYM_MAP: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT',
  'SOL/USDT': 'SOLUSDT', 'BNB/USDT': 'BNBUSDT',
};

@Injectable()
export class WatcherService {
  private readonly logger = new Logger(WatcherService.name);
  private readonly engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private systemPrisma: PrismaSystemService,
    private positions: PositionsService,
    private journal: JournalService,
    private http: HttpService,
    private notifications: NotificationsService,
    private priceAlerts: PriceAlertsService,
    private config: ConfigService,
    private health: SystemHealthService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  /** Fetch prices for non-Binance symbols from the engine (multi-provider fallback). */
  private async _fetchEnginePrices(symbols: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const { data } = await firstValueFrom(
            this.http.get<{ candles: Array<{ close: number }> }>(
              `${this.engineUrl}/candles/${encodeURIComponent(sym)}`,
              { params: { timeframe: '1m', limit: 50 }, timeout: 8000, headers: engineHeaders(this.config) },
            ),
          );
          if (data.candles && data.candles.length > 0) {
            result[sym] = parseFloat(String(data.candles[data.candles.length - 1].close));
          }
        } catch (e: any) {
          this.logger.warn(`Watcher: engine price fetch failed for ${sym} — ${e?.message}`);
        }
      }),
    );
    return result;
  }

  /** Build a unified price map (internal symbol → price) from Binance + engine. */
  private async _fetchAllPrices(allSymbols: string[]): Promise<Record<string, number>> {
    const binanceSymbols = [...new Set(allSymbols.map(s => SYM_MAP[s]).filter(Boolean))];
    const nonBinanceSymbols = allSymbols.filter(s => !SYM_MAP[s]);
    const internalPrices: Record<string, number> = {};

    // 1. Binance batch fetch
    if (binanceSymbols.length > 0) {
      try {
        const data = await retryWithBackoff(
          async () => {
            const { data: resp } = await firstValueFrom(
              this.http.get<{ symbol: string; price: string }[]>(BINANCE_PRICES, { timeout: 5000 }),
            );
            return resp;
          },
          {
            maxRetries: 3,
            baseDelayMs: 500,
            onRetry: (attempt, err) =>
              this.logger.warn(`Watcher: échec récupération prix Binance (tentative ${attempt}) — ${err.message}`),
          },
        );
        const binanceToInternal = Object.fromEntries(
          Object.entries(SYM_MAP).map(([internal, binance]) => [binance, internal]),
        );
        for (const d of data) {
          if (binanceSymbols.includes(d.symbol)) {
            const internal = binanceToInternal[d.symbol] ?? d.symbol;
            internalPrices[internal] = parseFloat(d.price);
          }
        }
      } catch {
        this.logger.error('Watcher: impossible de récupérer les prix Binance après 3 tentatives');
      }
    }

    // 2. Engine fetch for non-Binance symbols (forex, synthetics, BRVM, commodities)
    if (nonBinanceSymbols.length > 0) {
      const enginePrices = await this._fetchEnginePrices(nonBinanceSymbols);
      Object.assign(internalPrices, enginePrices);
    }

    return internalPrices;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async watchPositions() {
    try {
      const openPositions = await this.systemPrisma.position.findMany({
        where: { status: 'OPEN' },
        include: {
          asset:     { select: { symbol: true } },
          portfolio: { select: { userId: true } },
        },
      });

      if (openPositions.length === 0) {
        this.health.recordCronRun('watch-positions', 'ok');
        return;
      }

      const allSymbols = [...new Set(openPositions.map(p => p.asset.symbol))];
      const internalPrices = await this._fetchAllPrices(allSymbols);

      let closed = 0;

      for (const pos of openPositions) {
        const wasClosed = await rlsContext.run(pos.portfolio.userId, () =>
          this._watchOnePosition(pos, internalPrices),
        );
        if (wasClosed) closed++;
      }

      if (closed > 0) {
        this.logger.log(`Watcher: ${closed} position(s) fermée(s) automatiquement`);
      }

      try {
        await this.priceAlerts.checkAlerts(internalPrices);
      } catch (e: any) {
        this.logger.warn(`Watcher: price alert check failed — ${e?.message}`);
      }
      this.health.recordCronRun('watch-positions', 'ok');
    } catch (e: any) {
      this.health.recordCronRun('watch-positions', 'error', e?.message);
      this.logger.warn(`Watcher: watchPositions failed — ${e?.message}`);
    }
  }

  /** Returns true if the position was closed. */
  private async _watchOnePosition(pos: any, internalPrices: Record<string, number>): Promise<boolean> {
    const livePrice = internalPrices[pos.asset.symbol];
    if (!livePrice) return false;

    const entry = parseFloat(pos.entryPrice.toString());
    const sl    = pos.stopLoss   ? parseFloat(pos.stopLoss.toString())   : null;
    const tp    = pos.takeProfit ? parseFloat(pos.takeProfit.toString()) : null;

    let triggered: 'SL' | 'TP' | null = null;

    if (pos.direction === 'BUY') {
      if (sl && livePrice <= sl) triggered = 'SL';
      if (tp && livePrice >= tp) triggered = 'TP';
    } else {
      if (sl && livePrice >= sl) triggered = 'SL';
      if (tp && livePrice <= tp) triggered = 'TP';
    }

    if (!triggered) return false;

    const result = await this.positions.closeByWatcher(pos.id, livePrice, triggered);
    if (!result) return false;

    const pnlNum = parseFloat(result.pnl);
    this.logger.log(
      `Watcher: ${pos.asset.symbol} ${triggered} @ ${livePrice} | PnL ${result.pnl}`,
    );

    this.notifications.push({
      userId: pos.portfolio.userId,
      type: 'POSITION',
      title: `${triggered} touché — ${pos.asset.symbol}`,
      message: `Position ${pos.direction} fermée à ${livePrice} | PnL ${pnlNum > 0 ? '+' : ''}${pnlNum.toFixed(2)}`,
      data: { positionId: pos.id, symbol: pos.asset.symbol, triggered, pnl: pnlNum },
    });

    // Enregistrement automatique dans le journal (J19)
    try {
      await this.journal.createAuto({
        userId:    pos.portfolio.userId,
        assetSymbol: pos.asset.symbol,
        direction: pos.direction,
        entryPrice: entry,
        exitPrice:  livePrice,
        pnl:        parseFloat(result.pnl),
        pnlPct:     parseFloat(result.pnlPercent),
        closeReason: triggered,
        positionId:  pos.id,
      });
    } catch {
      this.logger.warn(`Watcher: journal auto failed for ${pos.id}`);
    }

    return true;
  }

  // Sprint 3 — Cycle de vie PENDING → ACTIVE / INVALIDATED pour les setups RETEST/LIMIT.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async watchPendingSignals() {
    try {
      const now = new Date();

      const expired = await this.prisma.signal.updateMany({
        where: { status: 'PENDING', expiresAt: { lt: now } },
        data: { status: 'INVALIDATED' },
      });
      if (expired.count > 0) {
        this.logger.log(`Watcher: ${expired.count} signal(s) PENDING invalidé(s) (expiré)`);
      }

      const pending = await this.prisma.signal.findMany({
        where: { status: 'PENDING', expiresAt: { gte: now } },
        include: { asset: { select: { symbol: true } } },
      });
      if (pending.length === 0) {
        this.health.recordCronRun('watch-pending-signals', 'ok');
        return;
      }

      const allSymbols = [...new Set(pending.map(s => s.asset.symbol))];
      const internalPrices = await this._fetchAllPrices(allSymbols);

      let activated = 0;
      for (const sig of pending) {
        const livePrice = internalPrices[sig.asset.symbol];
        if (!livePrice || !sig.entryPrice) continue;

        const entry = parseFloat(sig.entryPrice.toString());
        const triggered =
          (sig.signal === 'BUY' && livePrice <= entry) ||
          (sig.signal === 'SELL' && livePrice >= entry);
        if (!triggered) continue;

        await this.prisma.signal.update({ where: { id: sig.id }, data: { status: 'ACTIVE' } });
        activated++;
      }

      if (activated > 0) {
        this.logger.log(`Watcher: ${activated} signal(s) PENDING activé(s)`);
      }
      this.health.recordCronRun('watch-pending-signals', 'ok');
    } catch (e: any) {
      this.health.recordCronRun('watch-pending-signals', 'error', e?.message);
      this.logger.warn(`Watcher: watchPendingSignals failed — ${e?.message}`);
    }
  }

  /** Auto-transition PENDING positions → OPEN (exchange fill confirmed) or expire after 24h. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async watchPendingPositions() {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

      // Expire old PENDING positions (no fill confirmation within 24h)
      const expired = await this.prisma.position.updateMany({
        where: {
          status: 'PENDING',
          openedAt: { lt: cutoff },
        },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      if (expired.count > 0) {
        this.logger.log(`Watcher: ${expired.count} PENDING position(s) expired (>24h no confirmation)`);
      }

      // Check remaining PENDING positions for potential auto-confirmation
      const pending = await this.prisma.position.findMany({
        where: { status: 'PENDING' },
        include: { asset: { select: { symbol: true } }, portfolio: { select: { userId: true } } },
      });
      if (pending.length === 0) {
        this.health.recordCronRun('watch-pending-positions', 'ok');
        return;
      }

      const symbols = [...new Set(pending.map(p => p.asset.symbol))];
      const prices = await this._fetchAllPrices(symbols);

      let confirmed = 0;
      for (const pos of pending) {
        const livePrice = prices[pos.asset.symbol];
        if (!livePrice || !pos.entryPrice) continue;

        const entry = parseFloat(pos.entryPrice.toString());
        const slippagePct = Math.abs((livePrice - entry) / entry) * 100;

        // Auto-confirm if live price is within 2% of expected entry (fill likely occurred)
        if (slippagePct < 2.0) {
          // Recalculate SL/TP relative to the actual fill price, preserving original distances
          const updateData: any = { status: 'OPEN', entryPrice: livePrice };
          if (pos.stopLoss) {
            const slDist = entry - parseFloat(pos.stopLoss.toString());
            updateData.stopLoss = pos.direction === 'BUY'
              ? livePrice - Math.abs(slDist)
              : livePrice + Math.abs(slDist);
          }
          if (pos.takeProfit) {
            const tpDist = parseFloat(pos.takeProfit.toString()) - entry;
            updateData.takeProfit = pos.direction === 'BUY'
              ? livePrice + Math.abs(tpDist)
              : livePrice - Math.abs(tpDist);
          }
          if (pos.takeProfit2) {
            const tp2Dist = parseFloat(pos.takeProfit2.toString()) - entry;
            updateData.takeProfit2 = pos.direction === 'BUY'
              ? livePrice + Math.abs(tp2Dist)
              : livePrice - Math.abs(tp2Dist);
          }
          if (pos.trailingStop) {
            const tsDist = entry - parseFloat(pos.trailingStop.toString());
            updateData.trailingStop = pos.direction === 'BUY'
              ? livePrice - Math.abs(tsDist)
              : livePrice + Math.abs(tsDist);
          }

          await this.prisma.position.update({
            where: { id: pos.id },
            data: updateData,
          });
          confirmed++;
          this.logger.log(
            `Watcher: PENDING position ${pos.id} auto-confirmed (${pos.asset.symbol} @ ${livePrice}, slippage ${slippagePct.toFixed(2)}%)`,
          );
        }
      }

      if (confirmed > 0) {
        this.logger.log(`Watcher: ${confirmed} PENDING position(s) auto-confirmed`);
      }
      this.health.recordCronRun('watch-pending-positions', 'ok');
    } catch (e: any) {
      this.health.recordCronRun('watch-pending-positions', 'error', e?.message);
      this.logger.warn(`Watcher: watchPendingPositions failed — ${e?.message}`);
    }
  }
}
