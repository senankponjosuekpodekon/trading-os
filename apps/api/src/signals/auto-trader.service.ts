import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaSystemService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../common/services/feature-flags.service';
import { engineHeaders } from '../utils/engine-headers.util';

/**
 * AutoPilot — portfolio PAPER piloté automatiquement par les signaux.
 *
 * Design (validé) :
 * - Ouvre uniquement sur ENTRY_HIT réel (pas à la création du signal)
 * - Sizing : 1% du capital COURANT / distance SL (compounding)
 * - Cap exposition globale : Σ risques ouverts + nouveau ≤ 10% du capital
 * - Kill switch : capital < initial × 50% → auto_trader désactivé
 * - Partials : sizePct% de la taille ORIGINALE (aligné tracker, 33.3% par TP)
 * - Slippage simulé : 7 bps systématiquement défavorable (jamais favorable)
 * - Skip (jamais resize silencieux) si cap dépassé — l'attribution PnL
 *   par signal reste propre.
 */
export const AUTO_TRADER_FLAG = 'AUTO_TRADER_ENABLED';

const SLIPPAGE_BPS = 7;                    // 0.07%
const RISK_PCT = 0.01;                     // 1% du capital courant par trade
const MAX_TOTAL_EXPOSURE_PCT = 0.10;       // cap global 10%
const KILL_SWITCH_DRAWDOWN_PCT = 0.50;     // −50% → pause auto
const MAX_CONCURRENT_POSITIONS = 5;
export const AUTOPILOT_EMAIL = 'autopilot@system.local';
const AUTOPILOT_PORTFOLIO = 'AutoPilot';
const AUTOPILOT_INITIAL_CAPITAL = 10_000;

type TrackedEvent = 'ENTRY_HIT' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED' | 'MANUAL_CLOSE';
const MAX_ATTEMPTS = 5;
const LOCK_ID = 814_207;
type PaperDb = Prisma.TransactionClient;

@Injectable()
export class AutoTraderService {
  private readonly logger = new Logger(AutoTraderService.name);

  constructor(
    private prisma: PrismaSystemService,
    private flags: FeatureFlagsService,
    private config: ConfigService,
  ) {}

  private get minConfidence(): number {
    return this.config.get<number>('AUTO_TRADER_MIN_CONFIDENCE', 70);
  }

  private applySlippage(price: number, side: 'buy' | 'sell'): number {
    // Toujours défavorable : un achat paie plus cher, une vente reçoit moins.
    const bps = SLIPPAGE_BPS / 10_000;
    return side === 'buy' ? price * (1 + bps) : price * (1 - bps);
  }

  private async getAutopilotPortfolio(db: PaperDb, createIfMissing = true) {
    let user = await db.user.findUnique({ where: { email: AUTOPILOT_EMAIL } });
    if (!user && !createIfMissing) return null;
    if (!user) {
      user = await db.user.create({
        data: {
          email: AUTOPILOT_EMAIL,
          name: 'AutoPilot',
          password: 'disabled-login',
          role: 'TRADER',
          isActive: true,
        },
      });
    }
    let portfolio = await db.portfolio.findFirst({
      where: { userId: user.id, name: AUTOPILOT_PORTFOLIO },
    });
    if (!portfolio && !createIfMissing) return null;
    if (!portfolio) {
      portfolio = await db.portfolio.create({
        data: {
          userId: user.id,
          name: AUTOPILOT_PORTFOLIO,
          type: 'PAPER',
          initialCapital: AUTOPILOT_INITIAL_CAPITAL,
          currentCapital: AUTOPILOT_INITIAL_CAPITAL,
        },
      });
    }
    return portfolio;
  }

  /** Point d'entrée — file persistante traitée par le tracker et le cron. */
  @Cron('* * * * *')
  async processPendingEvents(limit = 50): Promise<void> {
    try {
      const pending = await this.prisma.signalExecutionEvent.findFirst({
        where: { autopilotStatus: { in: ['PENDING', 'RETRY'] } },
      });
      if (!pending) return;
      await this.prisma.$transaction(async db => {
        const [lock] = await db.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_ID}::bigint) AS acquired`;
        if (lock.acquired) await this.getAutopilotPortfolio(db);
      });
      for (let i = 0; i < limit; i++) {
        let attempted: { id: string; autopilotAttempts: number } | null = null;
        try {
          const processed = await this.prisma.$transaction(async db => {
            const [lock] = await db.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_ID}::bigint) AS acquired`;
            if (!lock.acquired) return false;
            const event = await db.signalExecutionEvent.findFirst({
              where: {
                autopilotStatus: { in: ['PENDING', 'RETRY'] },
                OR: [{ autopilotNextAttemptAt: null }, { autopilotNextAttemptAt: { lte: new Date() } }],
                signal: { executionEvents: { none: { OR: [
                  { autopilotStatus: 'FAILED' },
                  { autopilotStatus: 'RETRY', autopilotNextAttemptAt: { gt: new Date() } },
                ] } } },
              },
              orderBy: [{ candleTime: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
              include: { signal: { include: { asset: true } } },
            });
            if (!event || (event.autopilotNextAttemptAt && event.autopilotNextAttemptAt > new Date())) return false;
            attempted = event;
            let reason: string;
            if (event.type === 'ENTRY_HIT' && this.isStaleEntry(event)) {
              reason = 'STALE_ENTRY';
            } else {
              reason = await this.applyEvent(db, event.signal, event.type as TrackedEvent, Number(event.price));
            }
            if (reason === 'GATE_UNAVAILABLE') throw new Error('GATE_UNAVAILABLE');
            const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {};
            await db.signalExecutionEvent.update({
              where: { id: event.id },
              data: {
                autopilotStatus: reason.startsWith('PAPER_') ? 'COMPLETED' : 'SKIPPED',
                autopilotAttempts: { increment: 1 }, autopilotProcessedAt: new Date(), autopilotLastAttemptAt: new Date(),
                autopilotNextAttemptAt: null, autopilotLastError: null,
                metadata: { ...metadata, autopilot: { reason, mode: 'PAPER', recordedAt: new Date().toISOString() } },
              },
            });
            return { id: event.id, reason };
          }, { timeout: 15_000, maxWait: 5_000 });
          if (!processed) break;
          this.logger.log(`autopilot event=${processed.id} reason=${processed.reason}`);
        } catch (error) {
          const event = attempted as { id: string; autopilotAttempts: number } | null;
          if (!event) throw error;
          const attempts = event.autopilotAttempts + 1;
          const reason = error instanceof Error && error.message === 'GATE_UNAVAILABLE' ? 'GATE_UNAVAILABLE' : 'PROCESSING_ERROR';
          await this.prisma.signalExecutionEvent.updateMany({
            where: { id: event.id, autopilotStatus: { in: ['PENDING', 'RETRY'] }, autopilotAttempts: event.autopilotAttempts },
            data: {
              autopilotStatus: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'RETRY',
              autopilotAttempts: { increment: 1 }, autopilotLastError: reason, autopilotLastAttemptAt: new Date(),
              autopilotProcessedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
              autopilotNextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + 60_000 * 2 ** (attempts - 1)),
            },
          });
          this.logger.error(`autopilot event=${event.id} attempt=${attempts} reason=${reason}`);
          break;
        }
      }
    } catch {
      this.logger.error('autopilot queue processing unavailable; committed events remain pending');
    }
  }

  private isStaleEntry(event: { createdAt: Date; candleTime: Date; candleTimeframe: string; signal: { executionStatus: string } }): boolean {
    const timeframe = /^(\d+)(m|h|d|w)$/.exec(event.candleTimeframe);
    if (!timeframe) return true;
    const duration = Number(timeframe[1]) * ({ m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[timeframe[2]] ?? 0);
    return event.createdAt.getTime() < Date.now() - 15 * 60_000
      || event.candleTime.getTime() + duration < Date.now() - 15 * 60_000
      || !['PENDING', 'ACTIVE'].includes(event.signal.executionStatus);
  }

  private async applyEvent(db: PaperDb, signal: any, eventType: TrackedEvent, eventPrice: number): Promise<string> {
    if (!Number.isFinite(eventPrice) || eventPrice <= 0) return 'INVALID_EVENT_PRICE';
    if (eventType === 'ENTRY_HIT') {
      return await this.flags.getFlag(AUTO_TRADER_FLAG, false) ? this.maybeOpen(db, signal, eventPrice) : 'DISABLED';
    }
    if (eventType === 'SL_HIT' || eventType === 'EXPIRED' || eventType === 'MANUAL_CLOSE') {
      return this.closeRemaining(db, signal.id, eventPrice);
    }
    if (eventType === 'TP1_HIT' || eventType === 'TP2_HIT' || eventType === 'TP3_HIT') {
      return this.partialClose(db, signal.id, eventPrice, eventType);
    }
    return 'UNSUPPORTED_EVENT';
  }

  private async maybeOpen(db: PaperDb, signal: any, hitPrice: number): Promise<string> {
    const confidence = Number(signal.confidence);
    const threshold = Number(this.minConfidence);
    if (!Number.isFinite(confidence) || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) return 'INVALID_CONFIDENCE';
    if (confidence < threshold) return 'LOW_CONFIDENCE';
    if (!['BUY', 'SELL'].includes(signal.signal)) return 'INVALID_DIRECTION';
    const sl = Number(signal.stopLoss);
    const entry = hitPrice;
    if (!Number.isFinite(sl) || sl <= 0 || (signal.signal === 'BUY' ? sl >= entry : sl <= entry)) return 'INVALID_STOP';

    const portfolio = await this.getAutopilotPortfolio(db);
    if (!portfolio || portfolio.type !== 'PAPER') return 'NOT_PAPER_PORTFOLIO';
    const capital = Number(portfolio.currentCapital);
    if (!Number.isFinite(capital) || capital <= 0 || !Number.isFinite(Number(portfolio.initialCapital)) || Number(portfolio.initialCapital) <= 0) return 'INVALID_CAPITAL';

    // Kill switch : capital sous le seuil de drawdown → désactivation auto
    if (capital < Number(portfolio.initialCapital) * (1 - KILL_SWITCH_DRAWDOWN_PCT)) {
      await this.flags.setFlag(AUTO_TRADER_FLAG, false);
      this.logger.warn(`autopilot KILL SWITCH — capital ${capital} < ${Number(portfolio.initialCapital) * (1 - KILL_SWITCH_DRAWDOWN_PCT)}`);
      return 'KILL_SWITCH';
    }

    // Dédup : une seule position ouverte par actif
    const existing = await db.position.findFirst({
      where: { portfolioId: portfolio.id, OR: [{ signalId: signal.id }, { assetId: signal.assetId, status: 'OPEN' }] },
    });
    if (existing) return existing.signalId === signal.id ? 'ALREADY_PROCESSED' : 'ASSET_ALREADY_OPEN';

    // Max positions concurrentes
    const open = await db.position.findMany({
      where: { portfolioId: portfolio.id, status: 'OPEN' },
      select: { quantity: true, entryPrice: true, stopLoss: true },
    });
    if (open.length >= MAX_CONCURRENT_POSITIONS) return 'MAX_POSITIONS';

    const direction = signal.signal === 'SELL' ? 'SELL' : 'BUY';
    const effectiveEntry = this.applySlippage(entry, direction === 'BUY' ? 'buy' : 'sell');
    const slDistance = Math.abs(effectiveEntry - sl);
    const riskAmount = capital * RISK_PCT;
    const quantity = riskAmount / slDistance;
    if (!Number.isFinite(quantity) || quantity <= 0) return 'INVALID_SIZE';
    if (open.some(p => [p.quantity, p.entryPrice, p.stopLoss].some(v => v == null || !Number.isFinite(Number(v)) || Number(v) <= 0))) return 'INVALID_OPEN_RISK';

    // Cap d'exposition globale : Σ risques ouverts + nouveau ≤ 10% capital
    const openRisk = open.reduce((sum, p) => {
      const pSl = p.stopLoss ? Number(p.stopLoss) : null;
      if (!pSl) return sum;
      return sum + Number(p.quantity) * Math.abs(Number(p.entryPrice) - pSl);
    }, 0);
    if (openRisk + riskAmount > capital * MAX_TOTAL_EXPOSURE_PCT) {
      this.logger.log(`autopilot skip ${signal.asset?.symbol} — exposition globale plafonnée`);
      return 'EXPOSURE_LIMIT';
    }

    // Gate engine uniquement : marge, budget risque τ, cluster, gap.
    // La position PAPER locale ne doit jamais appeler l'exécuteur broker.
    // Fail-closed si l'engine est down — aucune entrée sans validation.
    const exec = await this._checkGate(portfolio.id, signal, effectiveEntry, sl, quantity);
    // Une réponse absente ou invalide bloque toujours l'entrée PAPER —
    // indépendamment de la configuration d'exécution réelle de l'engine.
    if (!exec) {
      this.logger.warn(`autopilot skip ${signal.asset?.symbol} — engine injoignable (GATE_FAIL_CLOSED)`);
      return 'GATE_UNAVAILABLE';
    }
    if (!exec.allow) {
      this.logger.log(`autopilot skip ${signal.asset?.symbol} — portfolio_gate rejected`);
      return 'GATE_REJECTED';
    }

    await db.position.create({
      data: {
        portfolioId: portfolio.id,
        assetId: signal.assetId,
        signalId: signal.id,
        direction,
        entryPrice: effectiveEntry,
        quantity,
        originalQuantity: quantity,
        pnl: 0,
        partialPnl: 0,
        secondPartialPnl: 0,
        stopLoss: sl,
        takeProfit: signal.takeProfit1 ? Number(signal.takeProfit1) : null,
        takeProfit2: signal.takeProfit2 ? Number(signal.takeProfit2) : null,
        takeProfit3: signal.takeProfit3 ? Number(signal.takeProfit3) : null,
        openedAt: new Date(),
      },
    });
    return 'PAPER_OPENED';
  }

  /** Gate engine sans ordre broker. null = validation indisponible. */
  private async _checkGate(
    portfolioId: string, signal: any, entry: number, sl: number | null, quantity: number,
  ): Promise<{ allow: boolean } | null> {
    const engineUrl = this.config.get<string>('ENGINE_URL') || 'http://engine:8000';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${engineUrl}/portfolio/can-open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...engineHeaders(this.config) },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          signal_id: signal.id,
          symbol: signal.asset?.symbol,
          direction: signal.signal === 'SELL' ? 'SELL' : 'BUY',
          entry, stop_loss: sl, qty: quantity,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        this.logger.warn(`autopilot gate HTTP ${res.status} signal=${signal.id}`);
        return null;
      }
      const result = await res.json();
      if (typeof result?.allow !== 'boolean') {
        this.logger.warn(`autopilot gate invalid response signal=${signal.id}`);
        return null;
      }
      return { allow: result.allow };
    } catch {
      this.logger.warn(`autopilot gate request failed signal=${signal.id}`);
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  /** Ferme sizePct% de la taille ORIGINALE (sémantique tracker : 33.3% par TP). */
  private async partialClose(db: PaperDb, signalId: string, rawPrice: number, tp: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT'): Promise<string> {
    // Filtrer par portfolioId : sans ça, une position USER ouverte depuis le
    // même signal serait modifiée par l'AutoPilot (écriture cross-user).
    const portfolio = await this.getAutopilotPortfolio(db, false);
    if (!portfolio) return 'NO_OPEN_POSITION';
    if (portfolio.type !== 'PAPER') return 'NOT_PAPER_PORTFOLIO';
    const position = await db.position.findFirst({
      where: { signalId, portfolioId: portfolio.id, status: 'OPEN' },
    });
    if (!position) return 'NO_OPEN_POSITION';
    if (tp === 'TP3_HIT') return this.closeRemaining(db, signalId, rawPrice);
    if ((tp === 'TP1_HIT' && position.partialExitAt) || (tp === 'TP2_HIT' && position.secondPartialExitAt)) return 'ALREADY_PROCESSED';

    const isLong = position.direction === 'BUY';
    const exitPrice = this.applySlippage(rawPrice, isLong ? 'sell' : 'buy');
    const entry = Number(position.entryPrice);
    const originalQty = Number(position.originalQuantity ?? position.quantity);
    const remainingQty = Number(position.quantity);
    const closeQty = Math.min(originalQty * (33.3 / 100), remainingQty);

    const realized = isLong
      ? (exitPrice - entry) * closeQty
      : (entry - exitPrice) * closeQty;
    const totalPnl = Number(position.pnl ?? 0) + realized;
    const realizedPct = (totalPnl / (entry * originalQty)) * 100;

    const fieldMap: Record<string, { at: string; price: string; pnl: string } | null> = {
      TP1_HIT: { at: 'partialExitAt', price: 'partialExitPrice', pnl: 'partialPnl' },
      TP2_HIT: { at: 'secondPartialExitAt', price: 'secondPartialExitPrice', pnl: 'secondPartialPnl' },
      TP3_HIT: null, // pas de colonnes dédiées → seulement qty/pnl/capital
    };
    const f = fieldMap[tp];
    const newQty = remainingQty - closeQty;

    await db.position.update({
      where: { id: position.id },
      data: {
        quantity: newQty,
        pnl: totalPnl,
        pnlPercent: realizedPct,
        ...(f ? { [f.at]: new Date(), [f.price]: exitPrice, [f.pnl]: Number(position[f.pnl] ?? 0) + realized } : {}),
      },
    });
    await db.portfolio.update({
      where: { id: position.portfolioId },
      data: { currentCapital: { increment: realized } },
    });
    return 'PAPER_PARTIAL_CLOSED';
  }

  private async closeRemaining(db: PaperDb, signalId: string, rawPrice: number): Promise<string> {
    // Même garde : restreindre au portfolio AutoPilot (cf. partialClose).
    const portfolio = await this.getAutopilotPortfolio(db, false);
    if (!portfolio) return 'NO_OPEN_POSITION';
    if (portfolio.type !== 'PAPER') return 'NOT_PAPER_PORTFOLIO';
    const position = await db.position.findFirst({
      where: { signalId, portfolioId: portfolio.id, status: 'OPEN' },
    });
    if (!position) return 'NO_OPEN_POSITION';

    const isLong = position.direction === 'BUY';
    const exitPrice = this.applySlippage(rawPrice, isLong ? 'sell' : 'buy');
    const entry = Number(position.entryPrice);
    const remainingQty = Number(position.quantity);
    const realized = isLong
      ? (exitPrice - entry) * remainingQty
      : (entry - exitPrice) * remainingQty;
    const totalPnl = Number(position.pnl ?? 0) + realized;
    const cost = entry * Number(position.originalQuantity ?? remainingQty);
    const pnlPct = cost > 0 ? (totalPnl / cost) * 100 : 0;

    await db.position.update({
      where: { id: position.id },
      data: {
        status: 'CLOSED',
        quantity: 0,
        exitPrice,
        closedAt: new Date(),
        pnl: totalPnl,
        pnlPercent: pnlPct,
      },
    });
    await db.portfolio.update({
      where: { id: position.portfolioId },
      data: { currentCapital: { increment: realized } },
    });
    return 'PAPER_CLOSED';
  }
}
