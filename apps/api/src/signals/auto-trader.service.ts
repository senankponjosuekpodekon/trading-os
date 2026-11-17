import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
const AUTOPILOT_EMAIL = 'autopilot@system.local';
const AUTOPILOT_PORTFOLIO = 'AutoPilot';
const AUTOPILOT_INITIAL_CAPITAL = 10_000;

type TrackedEvent = 'ENTRY_HIT' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED' | 'MANUAL_CLOSE';

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

  private async getAutopilotPortfolio(createIfMissing = true) {
    let user = await this.prisma.user.findUnique({ where: { email: AUTOPILOT_EMAIL } });
    if (!user && !createIfMissing) return null;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: AUTOPILOT_EMAIL,
          name: 'AutoPilot',
          password: 'disabled-login',
          role: 'TRADER',
          isActive: true,
        },
      });
    }
    let portfolio = await this.prisma.portfolio.findFirst({
      where: { userId: user.id, name: AUTOPILOT_PORTFOLIO },
    });
    if (!portfolio && !createIfMissing) return null;
    if (!portfolio) {
      portfolio = await this.prisma.portfolio.create({
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

  /** Point d'entrée — appelé par le tracker après chaque event créé. */
  async handleSignalEvent(signal: any, eventType: TrackedEvent, eventPrice: number): Promise<void> {
    let reason = 'UNSUPPORTED_EVENT';
    try {
      if (!Number.isFinite(eventPrice) || eventPrice <= 0) {
        reason = 'INVALID_EVENT_PRICE';
      } else if (eventType === 'ENTRY_HIT') {
        reason = await this.flags.getFlag(AUTO_TRADER_FLAG, false)
          ? await this.maybeOpen(signal, eventPrice)
          : 'DISABLED';
      } else if (eventType === 'SL_HIT' || eventType === 'EXPIRED' || eventType === 'MANUAL_CLOSE') {
        reason = await this.closeRemaining(signal.id, eventPrice);
      } else if (eventType.startsWith('TP')) {
        reason = await this.partialClose(signal.id, eventPrice, eventType);
      }
    } catch {
      reason = 'PROCESSING_ERROR';
      this.logger.error(`autopilot ${eventType} signal=${signal.id}: ${reason}`);
    }
    await this.recordDecision(signal.id, eventType, reason);
  }

  private async recordDecision(signalId: string, type: TrackedEvent, reason: string): Promise<void> {
    this.logger.log(`autopilot signal=${signalId} event=${type} reason=${reason}`);
    try {
      const event = await this.prisma.signalExecutionEvent.findFirst({
        where: { signalId, type }, orderBy: { candleTime: 'desc' },
      });
      if (!event) return;
      const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata : {};
      await this.prisma.signalExecutionEvent.update({
        where: { id: event.id },
        data: { metadata: { ...metadata, autopilot: { reason, mode: 'PAPER', recordedAt: new Date().toISOString() } } },
      });
    } catch {
      this.logger.error(`autopilot decision persistence failed signal=${signalId} event=${type}`);
    }
  }

  private async maybeOpen(signal: any, hitPrice: number): Promise<string> {
    const confidence = Number(signal.confidence);
    const threshold = Number(this.minConfidence);
    if (!Number.isFinite(confidence) || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) return 'INVALID_CONFIDENCE';
    if (confidence < threshold) return 'LOW_CONFIDENCE';
    if (!['BUY', 'SELL'].includes(signal.signal)) return 'INVALID_DIRECTION';
    const sl = Number(signal.stopLoss);
    const entry = hitPrice;
    if (!Number.isFinite(sl) || sl <= 0 || (signal.signal === 'BUY' ? sl >= entry : sl <= entry)) return 'INVALID_STOP';

    const portfolio = await this.getAutopilotPortfolio();
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
    const existing = await this.prisma.position.findFirst({
      where: { portfolioId: portfolio.id, OR: [{ signalId: signal.id }, { assetId: signal.assetId, status: 'OPEN' }] },
    });
    if (existing) return existing.signalId === signal.id ? 'ALREADY_PROCESSED' : 'ASSET_ALREADY_OPEN';

    // Max positions concurrentes
    const open = await this.prisma.position.findMany({
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

    await this.prisma.position.create({
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
    this.logger.log(`autopilot OPEN ${direction === 'BUY' ? 'LONG' : 'SHORT'} ${signal.asset?.symbol} qty=${quantity.toFixed(6)} @ ${effectiveEntry.toFixed(2)} (conf ${signal.confidence}%)`);
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
  private async partialClose(signalId: string, rawPrice: number, tp: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT'): Promise<string> {
    // Filtrer par portfolioId : sans ça, une position USER ouverte depuis le
    // même signal serait modifiée par l'AutoPilot (écriture cross-user).
    const portfolio = await this.getAutopilotPortfolio(false);
    if (!portfolio) return 'NO_OPEN_POSITION';
    if (portfolio.type !== 'PAPER') return 'NOT_PAPER_PORTFOLIO';
    const position = await this.prisma.position.findFirst({
      where: { signalId, portfolioId: portfolio.id, status: 'OPEN' },
    });
    if (!position) return 'NO_OPEN_POSITION';
    if (tp === 'TP3_HIT') return this.closeRemaining(signalId, rawPrice);
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

    await this.prisma.$transaction([
      this.prisma.position.update({
        where: { id: position.id },
        data: {
          quantity: newQty,
          pnl: totalPnl,
          pnlPercent: realizedPct,
          ...(f ? { [f.at]: new Date(), [f.price]: exitPrice, [f.pnl]: Number(position[f.pnl] ?? 0) + realized } : {}),
        },
      }),
      this.prisma.portfolio.update({
        where: { id: position.portfolioId },
        data: { currentCapital: { increment: realized } },
      }),
    ]);
    this.logger.log(`autopilot ${tp} position=${position.id} closeQty=${closeQty.toFixed(6)} pnl=${realized.toFixed(2)}`);
    return 'PAPER_PARTIAL_CLOSED';
  }

  private async closeRemaining(signalId: string, rawPrice: number): Promise<string> {
    // Même garde : restreindre au portfolio AutoPilot (cf. partialClose).
    const portfolio = await this.getAutopilotPortfolio(false);
    if (!portfolio) return 'NO_OPEN_POSITION';
    if (portfolio.type !== 'PAPER') return 'NOT_PAPER_PORTFOLIO';
    const position = await this.prisma.position.findFirst({
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

    await this.prisma.$transaction([
      this.prisma.position.update({
        where: { id: position.id },
        data: {
          status: 'CLOSED',
          quantity: 0,
          exitPrice,
          closedAt: new Date(),
          pnl: totalPnl,
          pnlPercent: pnlPct,
        },
      }),
      this.prisma.portfolio.update({
        where: { id: position.portfolioId },
        data: { currentCapital: { increment: realized } },
      }),
    ]);
    this.logger.log(`autopilot CLOSE position=${position.id} realized=${realized.toFixed(2)} total=${totalPnl.toFixed(2)}`);
    return 'PAPER_CLOSED';
  }
}
