import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionService } from './execution.service';
import { OrderSide, OrderType } from './dto/execute-order.dto';

/**
 * Auto-exec — exécution automatique des signaux qualifiés sur les
 * connexions MT5 actives (compte DéRIV-DEMO dans le setup actuel).
 *
 * Emprunte le SEUL chemin d'exécution MT5 : ExecutionService →
 * Mt5Connector (sizing contrat réel, stops_level, marge, réconciliation).
 * Jamais de contournement direct vers le bridge.
 *
 * Filtres (fail-closed — un signal douteux est sauté, jamais exécuté) :
 *  - confidence ≥ AUTOEXEC_MIN_CONFIDENCE (défaut 80)
 *  - metadata.tp_feasibility !== 'LOW' (objectif au-delà du cône 95%)
 *  - metadata.sl_in_noise !== true (stop placé dans le bruit < 1σ)
 *  - signal récent (< AUTOEXEC_MAX_AGE_MIN, défaut 10 min)
 *  - une seule exécution par signal par utilisateur (position existante
 *    avec ce signalId dans le portfolio LIVE → skip)
 *  - cap journalier AUTOEXEC_MAX_DAILY (défaut 10)
 *
 * Env :
 *  AUTOEXEC_ENABLED=1     (requis — sinon le scheduler est inerte)
 *  AUTOEXEC_MIN_CONFIDENCE, AUTOEXEC_MAX_AGE_MIN, AUTOEXEC_MAX_DAILY,
 *  AUTOEXEC_NOTIONAL_USD  (notional de base pour qty = notional/entry)
 */
@Injectable()
export class AutoExecScheduler {
  private readonly logger = new Logger(AutoExecScheduler.name);
  private readonly enabled = process.env.AUTOEXEC_ENABLED === '1';
  private readonly minConfidence = parseFloat(process.env.AUTOEXEC_MIN_CONFIDENCE ?? '80');
  private readonly maxAgeMin = parseInt(process.env.AUTOEXEC_MAX_AGE_MIN ?? '10', 10);
  private readonly maxDaily = parseInt(process.env.AUTOEXEC_MAX_DAILY ?? '10', 10);
  private readonly notionalUsd = parseFloat(process.env.AUTOEXEC_NOTIONAL_USD ?? '2500');

  private attempted = new Set<string>();
  private dailyCount = 0;
  private dailyDate = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: ExecutionService,
  ) {}

  @Cron('*/2 * * * *')
  async run() {
    if (!this.enabled) return;

    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyDate) {
      this.dailyDate = today;
      this.dailyCount = 0;
    }
    if (this.dailyCount >= this.maxDaily) return;

    const connections = await this.prisma.exchangeConnection.findMany({
      where: { exchange: 'MT5', isActive: true },
      select: { id: true, userId: true },
    });
    if (!connections.length) return;

    const cutoff = new Date(Date.now() - this.maxAgeMin * 60_000);
    const signals = await this.prisma.signal.findMany({
      where: {
        signal: { in: ['BUY', 'SELL'] },
        confidence: { gte: this.minConfidence },
        createdAt: { gte: cutoff },
      },
      include: { asset: { select: { symbol: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const s of signals) {
      if (this.dailyCount >= this.maxDaily) break;
      if (this.attempted.has(s.id)) continue;

      const meta = (s.metadata ?? {}) as Record<string, any>;
      if (meta.tp_feasibility === 'LOW' || meta.sl_in_noise === true) {
        this.attempted.add(s.id);
        this.logger.log(`autoexec skip ${s.asset.symbol}: tp_feasibility=${meta.tp_feasibility} sl_in_noise=${meta.sl_in_noise}`);
        continue;
      }

      const entry = Number(s.entryPrice);
      if (!entry || entry <= 0) continue;
      const quantity = +(this.notionalUsd / entry).toFixed(8);
      if (quantity <= 0) continue;

      for (const conn of connections) {
        const portfolio = await this.prisma.portfolio.findFirst({
          where: { userId: conn.userId, type: 'LIVE' },
          select: { id: true },
        });
        if (!portfolio) {
          this.logger.warn(`autoexec: pas de portfolio LIVE pour user ${conn.userId} — signal ${s.id} ignoré`);
          continue;
        }

        const existing = await this.prisma.position.findFirst({
          where: { signalId: s.id, portfolioId: portfolio.id },
          select: { id: true },
        });
        if (existing) continue;

        try {
          const res = await this.execution.executeOrder(conn.userId, {
            connectionId: conn.id,
            symbol: s.asset.symbol,
            side: s.signal as OrderSide,
            type: OrderType.MARKET,
            quantity,
            signalId: s.id,
            portfolioId: portfolio.id,
            stopLoss: s.stopLoss != null ? Number(s.stopLoss) : undefined,
            takeProfit: s.takeProfit1 != null ? Number(s.takeProfit1) : undefined,
          });
          this.attempted.add(s.id);
          this.dailyCount++;
          this.logger.log(
            `autoexec FILLED: ${s.signal} ${s.asset.symbol} qty=${quantity} ` +
            `conf=${s.confidence} order=${res.orderId ?? 'n/a'} (${this.dailyCount}/${this.maxDaily})`,
          );
        } catch (err: any) {
          this.attempted.add(s.id);
          this.logger.warn(`autoexec failed ${s.asset.symbol} ${s.signal}: ${err?.message?.slice(0, 200)}`);
        }
      }
    }

    // Mémoire : caper le set pour éviter la dérive sur longue durée.
    if (this.attempted.size > 2000) {
      this.attempted = new Set([...this.attempted].slice(-1000));
    }
  }
}
