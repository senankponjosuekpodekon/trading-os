import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../billing/quota.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';

@Injectable()
export class PortfoliosService {
  constructor(
    private prisma: PrismaService,
    private quota: QuotaService,
    private config: ConfigService,
  ) {}

  private async _owned(userId: string, portfolioId: string) {
    const pf = await this.prisma.portfolio.findFirst({
      where: { id: portfolioId, userId },
    });
    if (!pf) throw new NotFoundException('Portfolio not found');
    return pf;
  }

  /** État consolidé temps réel — calculé par l'engine (marge, risque, clusters). */
  async state(userId: string, portfolioId: string) {
    const pf = await this._owned(userId, portfolioId);
    const engineUrl = this.config.get<string>('ENGINE_URL', 'http://engine:8000');
    const engineKey = this.config.get<string>('ENGINE_API_KEY', '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${engineUrl}/portfolio/state/${portfolioId}`,
        { signal: ctrl.signal, headers: { 'X-Engine-Key': engineKey } });
      clearTimeout(t);
      if (res.ok) return await res.json();
    } catch {}
    // Fallback minimal si l'engine est down
    const open = await this.prisma.position.findMany({
      where: { portfolioId, status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] } },
    });
    return {
      portfolio_id: portfolioId, name: pf.name, type: pf.type,
      equity: Number(pf.currentCapital), cash: Number(pf.currentCapital),
      cash_free: null, margin_locked: null, unrealized_pnl: null,
      n_positions: open.length, stale: true,
      positions: [], clusters: {}, venues: {},
    };
  }

  async snapshots(userId: string, portfolioId: string, limit = 168) {
    await this._owned(userId, portfolioId);
    return this.prisma.$queryRaw`
      SELECT equity, cash, cash_free, margin_locked, unrealized_pnl,
             n_positions, risk_to_stop, gap_loss, created_at AS ts
      FROM portfolio_snapshots
      WHERE "portfolioId" = ${portfolioId}
      ORDER BY created_at DESC LIMIT ${limit}`;
  }

  async ledger(userId: string, portfolioId: string, limit = 100) {
    await this._owned(userId, portfolioId);
    return this.prisma.$queryRaw`
      SELECT event, amount, balance_after, symbol, metadata, created_at AS ts
      FROM account_ledger
      WHERE "portfolioId" = ${portfolioId}
      ORDER BY created_at DESC LIMIT ${limit}`;
  }

  /** Config effective : ligne DB + adapters enregistrés côté engine. */
  async execConfig() {
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT mode, live_venues, gate_fail_closed, updated_by, updated_at
      FROM execution_config WHERE id='default'`;
    const db = rows[0] ?? null;
    let engine: any = null;
    const engineUrl = this.config.get<string>('ENGINE_URL', 'http://engine:8000');
    const engineKey = this.config.get<string>('ENGINE_API_KEY', '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${engineUrl}/portfolio/execution-status`,
        { signal: ctrl.signal, headers: { 'X-Engine-Key': engineKey } });
      clearTimeout(t);
      if (res.ok) engine = await res.json();
    } catch {}
    return { db, engine };
  }

  /** Écrit la config pilotée UI — l'engine la relit sous ~30s. */
  async updateExecConfig(userId: string, dto: { mode?: string; live_venues?: string[]; gate_fail_closed?: boolean }) {
    const mode = dto.mode;
    if (mode && !['shadow', 'paper', 'live'].includes(mode)) {
      throw new Error('mode invalide (shadow|paper|live)');
    }
    const venues = dto.live_venues
      ? JSON.stringify(dto.live_venues.map(v => v.toUpperCase()))
      : null;
    await this.prisma.$executeRaw`
      UPDATE execution_config SET
        mode = COALESCE(${mode ?? null}, mode),
        live_venues = COALESCE(${venues}::jsonb, live_venues),
        gate_fail_closed = COALESCE(${dto.gate_fail_closed ?? null}, gate_fail_closed),
        updated_by = ${userId}, updated_at = now()
      WHERE id = 'default'`;
    return this.execConfig();
  }

  async findByUser(userId: string) {
    return this.prisma.portfolio.findMany({
      where: { userId },
      include: { positions: { where: { status: 'OPEN' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreatePortfolioDto) {
    await this.quota.assertCanCreatePortfolio(userId);
    const capital = dto.initialCapital ?? 10000;
    return this.prisma.portfolio.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        currency: dto.currency ?? 'USD',
        initialCapital: capital,
        currentCapital: capital,
      },
    });
  }
}
