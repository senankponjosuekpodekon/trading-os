import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../common/services/feature-flags.service';

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
    private prisma: PrismaService,
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

  private async getAutopilotPortfolio() {
    let user = await this.prisma.user.findUnique({ where: { email: AUTOPILOT_EMAIL } });
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
    if (!(await this.flags.getFlag(AUTO_TRADER_FLAG, false))) return;
    try {
      if (eventType === 'ENTRY_HIT') {
        await this.maybeOpen(signal, eventPrice);
      } else if (eventType === 'SL_HIT' || eventType === 'EXPIRED' || eventType === 'MANUAL_CLOSE') {
        await this.closeRemaining(signal.id, eventPrice);
      } else if (eventType.startsWith('TP')) {
        await this.partialClose(signal.id, eventPrice, eventType);
      }
    } catch (err) {
      this.logger.warn(`autopilot ${eventType} signal=${signal.id}: ${(err as Error)?.message}`);
    }
  }

  private async maybeOpen(signal: any, hitPrice: number): Promise<void> {
    if ((signal.confidence ?? 0) < this.minConfidence) return;
    const sl = signal.stopLoss ? Number(signal.stopLoss) : null;
    const entry = signal.entryPrice ? Number(signal.entryPrice) : hitPrice;
    if (!sl || !entry || sl === entry) return;

    const portfolio = await this.getAutopilotPortfolio();
    const capital = Number(portfolio.currentCapital);

    // Kill switch : capital sous le seuil de drawdown → désactivation auto
    if (capital < Number(portfolio.initialCapital) * (1 - KILL_SWITCH_DRAWDOWN_PCT)) {
      await this.flags.setFlag(AUTO_TRADER_FLAG, false);
      this.logger.warn(`autopilot KILL SWITCH — capital ${capital} < ${Number(portfolio.initialCapital) * (1 - KILL_SWITCH_DRAWDOWN_PCT)}`);
      return;
    }

    // Dédup : une seule position ouverte par actif
    const existing = await this.prisma.position.findFirst({
      where: { portfolioId: portfolio.id, assetId: signal.assetId, status: 'OPEN' },
    });
    if (existing) return;

    // Max positions concurrentes
    const open = await this.prisma.position.findMany({
      where: { portfolioId: portfolio.id, status: 'OPEN' },
      select: { quantity: true, entryPrice: true, stopLoss: true },
    });
    if (open.length >= MAX_CONCURRENT_POSITIONS) return;

    const direction = signal.signal === 'SELL' ? 'SELL' : 'BUY';
    const slDistance = Math.abs(entry - sl);
    const riskAmount = capital * RISK_PCT;
    const quantity = riskAmount / slDistance;

    // Cap d'exposition globale : Σ risques ouverts + nouveau ≤ 10% capital
    const openRisk = open.reduce((sum, p) => {
      const pSl = p.stopLoss ? Number(p.stopLoss) : null;
      if (!pSl) return sum;
      return sum + Number(p.quantity) * Math.abs(Number(p.entryPrice) - pSl);
    }, 0);
    if (openRisk + riskAmount > capital * MAX_TOTAL_EXPOSURE_PCT) {
      this.logger.log(`autopilot skip ${signal.asset?.symbol} — exposition globale plafonnée`);
      return;
    }

    const effectiveEntry = this.applySlippage(entry, direction === 'BUY' ? 'buy' : 'sell');
    await this.prisma.position.create({
      data: {
        portfolioId: portfolio.id,
        assetId: signal.assetId,
        signalId: signal.id,
        direction,
        entryPrice: effectiveEntry,
        quantity,
        originalQuantity: quantity,
        stopLoss: sl,
        takeProfit: signal.takeProfit1 ? Number(signal.takeProfit1) : null,
        takeProfit2: signal.takeProfit2 ? Number(signal.takeProfit2) : null,
        takeProfit3: signal.takeProfit3 ? Number(signal.takeProfit3) : null,
        openedAt: new Date(),
      },
    });
    this.logger.log(`autopilot OPEN ${direction === 'BUY' ? 'LONG' : 'SHORT'} ${signal.asset?.symbol} qty=${quantity.toFixed(6)} @ ${effectiveEntry.toFixed(2)} (conf ${signal.confidence}%)`);
  }

  /** Ferme sizePct% de la taille ORIGINALE (sémantique tracker : 33.3% par TP). */
  private async partialClose(signalId: string, rawPrice: number, tp: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT'): Promise<void> {
    const position = await this.prisma.position.findFirst({
      where: { signalId, status: 'OPEN' },
    });
    if (!position) return;

    const isLong = position.direction === 'BUY';
    const exitPrice = this.applySlippage(rawPrice, isLong ? 'sell' : 'buy');
    const entry = Number(position.entryPrice);
    const originalQty = Number(position.originalQuantity ?? position.quantity);
    const remainingQty = Number(position.quantity);
    const closeQty = Math.min(originalQty * (33.3 / 100), remainingQty);

    const realized = isLong
      ? (exitPrice - entry) * closeQty
      : (entry - exitPrice) * closeQty;
    const realizedPct = ((exitPrice - entry) / entry) * 100 * (isLong ? 1 : -1);

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
          pnl: { increment: realized },
          pnlPercent: realizedPct,
          ...(f ? { [f.at]: new Date(), [f.price]: exitPrice, [f.pnl]: { increment: realized } } : {}),
        },
      }),
      this.prisma.portfolio.update({
        where: { id: position.portfolioId },
        data: { currentCapital: { increment: realized } },
      }),
    ]);
    this.logger.log(`autopilot ${tp} position=${position.id} closeQty=${closeQty.toFixed(6)} pnl=${realized.toFixed(2)}`);
  }

  private async closeRemaining(signalId: string, rawPrice: number): Promise<void> {
    const position = await this.prisma.position.findFirst({
      where: { signalId, status: 'OPEN' },
    });
    if (!position) return;

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
  }
}
