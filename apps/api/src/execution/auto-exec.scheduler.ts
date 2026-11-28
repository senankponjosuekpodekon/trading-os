import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaSystemService } from '../prisma/prisma.service';
import { ExecutionService } from './execution.service';
import { Mt5Connector } from './mt5.connector';
import { OrderSide, OrderType } from './dto/execute-order.dto';

/**
 * Auto-exec — exécution automatique des signaux qualifiés sur le compte
 * MT5 du bridge (Deriv-Demo dans le setup actuel).
 *
 * Architecture : le bridge porte UN compte broker partagé → la dédup se
 * fait au niveau SIGNAL + POSITION BROKER, pas par utilisateur (sinon 2
 * users exécuteraient le même signal deux fois sur le même compte).
 * La première connexion MT5 active trouvée sert d'identité d'exécution.
 *
 * Protections (fail-closed) :
 *  - advisory lock Postgres : un seul run à la fois, quelle que soit
 *    la latence ou le nombre d'instances
 *  - confidence ≥ AUTOEXEC_MIN_CONFIDENCE (défaut 80), signal <10 min,
 *    isActive, pas de sentiment_pending
 *  - tp_feasibility≠LOW, sl_in_noise≠true
 *  - dédup : signalId déjà lié à une Position + position MT5 ouverte
 *    sur le symbole (magic 20261118) → skip
 *  - cap AUTOEXEC_MAX_DAILY/jour (compte, pas user)
 *  - erreur transport (bridge down, timeout) → NON marquée attempted :
 *    le signal est retenté au prochain run pendant sa fenêtre ; les
 *    rejets métier (gate, sizing) sont définitifs
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
    private readonly prisma: PrismaSystemService,
    private readonly execution: ExecutionService,
    private readonly mt5: Mt5Connector,
  ) {}

  @Cron('*/2 * * * *')
  async run() {
    if (!this.enabled) return;

    // Un seul run concurrent, quel que soit le nombre d'instances.
    const locked = await this.prisma.$queryRaw<{ got: boolean }[]>`
      SELECT pg_try_advisory_lock(20261128) AS got`;
    if (!locked[0]?.got) return;

    try {
      await this._run();
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(20261128)`;
    }
  }

  private async _run() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyDate) {
      this.dailyDate = today;
      this.dailyCount = 0;
    }
    if (this.dailyCount >= this.maxDaily) return;

    // Compte broker unique → une seule connexion d'exécution.
    const conn = await this.prisma.exchangeConnection.findFirst({
      where: { exchange: 'MT5', isActive: true },
      select: { id: true, userId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!conn) return;

    const portfolio = await this.prisma.portfolio.findFirst({
      where: { userId: conn.userId, type: 'LIVE' },
      select: { id: true },
    });
    if (!portfolio) {
      this.logger.warn(`autoexec: pas de portfolio LIVE pour user ${conn.userId} — run ignoré`);
      return;
    }

    // Positions broker actuelles (magic 20261118) → dédup au niveau compte.
    let openSymbols = new Set<string>();
    try {
      const positions = await this.mt5.getPositions();
      openSymbols = new Set(positions.map((p: any) => p.symbol));
    } catch (e: any) {
      this.logger.warn(`autoexec: positions MT5 illisibles (${e?.message?.slice(0, 80)}) — run ignoré`);
      return;
    }

    const cutoff = new Date(Date.now() - this.maxAgeMin * 60_000);
    const signals = await this.prisma.signal.findMany({
      where: {
        signal: { in: ['BUY', 'SELL'] },
        confidence: { gte: this.minConfidence },
        isActive: true,
        createdAt: { gte: cutoff },
      },
      include: { asset: { select: { symbol: true } } },
      orderBy: { confidence: 'desc' },
      take: 20,
    });

    for (const s of signals) {
      if (this.dailyCount >= this.maxDaily) break;
      if (this.attempted.has(s.id)) continue;

      const meta = (s.metadata ?? {}) as Record<string, any>;
      if (meta.tp_feasibility === 'LOW' || meta.sl_in_noise === true || meta.sentiment_pending === true) {
        this.attempted.add(s.id);
        continue;
      }

      // Symbole déjà ouvert sur le compte broker → skip.
      const mt5Symbol = this.mt5.mapSymbol(s.asset.symbol);
      if (openSymbols.has(mt5Symbol)) {
        this.attempted.add(s.id);
        continue;
      }

      // Signal déjà exécuté (manuel ou auto) → Position liée existe.
      const existing = await this.prisma.position.findFirst({
        where: { signalId: s.id, portfolioId: portfolio.id },
        select: { id: true },
      });
      if (existing) {
        this.attempted.add(s.id);
        continue;
      }

      const entry = Number(s.entryPrice);
      if (!entry || entry <= 0) continue;
      const quantity = +(this.notionalUsd / entry).toFixed(8);
      if (quantity <= 0) continue;

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
        openSymbols.add(mt5Symbol);
        this.logger.log(
          `autoexec FILLED: ${s.signal} ${s.asset.symbol} qty=${quantity} ` +
          `conf=${s.confidence} order=${res.orderId ?? 'n/a'} (${this.dailyCount}/${this.maxDaily})`,
        );
      } catch (err: any) {
        const status = err?.response?.status ?? err?.status;
        const retriable = status == null || status >= 500;
        if (!retriable) this.attempted.add(s.id); // rejet métier définitif
        this.logger.warn(
          `autoexec ${retriable ? 'retry-l8r' : 'rejected'} ${s.asset.symbol} ${s.signal}: ` +
          `${err?.message?.slice(0, 160)}`,
        );
      }
    }

    if (this.attempted.size > 2000) {
      this.attempted = new Set([...this.attempted].slice(-1000));
    }
  }
}
