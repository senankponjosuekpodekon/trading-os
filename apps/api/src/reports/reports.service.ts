import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async generateDailyReport() {
    this.logger.log('Starting daily report generation...');
    try {
      const report = await this.collectReportData();
      const summary = this.buildSummary(report);
      const interpretation = this.buildInterpretation(report);

      const saved = await this.prisma.dailyReport.create({
        data: {
          date: new Date(),
          data: report as any,
          summary,
          interpretation,
        },
      });

      this.logger.log(`Daily report saved: ${saved.id}`);
      return saved;
    } catch (err) {
      this.logger.error('Failed to generate daily report', err);
    }
  }

  async listReports(limit = 30) {
    return this.prisma.dailyReport.findMany({
      orderBy: { date: 'desc' },
      take: limit,
      select: {
        id: true,
        date: true,
        summary: true,
        interpretation: true,
        createdAt: true,
      },
    });
  }

  async getReport(id: string) {
    return this.prisma.dailyReport.findUnique({ where: { id } });
  }

  async getLatestReport() {
    return this.prisma.dailyReport.findFirst({
      orderBy: { date: 'desc' },
    });
  }

  private async collectReportData(): Promise<any> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      signals24h,
      signalsByDirection,
      signalsByStatus,
      topSignals,
      scanHistory24h,
      portfolioStats,
      userCount,
      activeStrategies,
      positions,
      closedSignals7d,
      cronHealth,
      containerStats,
    ] = await Promise.all([
      this.prisma.signal.count({ where: { createdAt: { gte: yesterday } } }),
      this.prisma.signal.groupBy({
        by: ['signal'],
        where: { createdAt: { gte: yesterday } },
        _count: true,
      }),
      this.prisma.signal.groupBy({
        by: ['status'],
        where: { createdAt: { gte: yesterday } },
        _count: true,
      }),
      this.prisma.signal.findMany({
        where: { createdAt: { gte: yesterday }, signal: { in: ['BUY', 'SELL'] } },
        orderBy: { confidence: 'desc' },
        take: 10,
        include: { asset: { select: { symbol: true } } },
      }),
      this.prisma.scanHistory.findMany({
        where: { scannedAt: { gte: yesterday } },
        orderBy: { scannedAt: 'desc' },
        take: 20,
        select: {
          symbol: true, signal: true, confidence: true,
          timeframe: true, strategyName: true, scannedAt: true,
        },
      }),
      this.prisma.portfolio.aggregate({ _sum: { currentCapital: true } }),
      this.prisma.user.count(),
      this.prisma.strategy.count({ where: { isActive: true } }),
      this.prisma.position.findMany({
        where: { status: 'OPEN' },
        select: {
          direction: true, entryPrice: true,
          pnl: true, pnlPercent: true, quantity: true,
          asset: { select: { symbol: true } },
        },
      }),
      this.prisma.signal.findMany({
        where: { createdAt: { gte: weekAgo }, status: 'INVALIDATED' },
        select: { signal: true, status: true, confidence: true },
      }),
      this.getSystemHealth(),
      this.getContainerStats(),
    ]);

    const losses = closedSignals7d.length;
    const active7d = await this.prisma.signal.count({
      where: { createdAt: { gte: weekAgo }, status: 'ACTIVE' },
    });
    const outcomesTotal = losses + active7d;
    const winRate = outcomesTotal > 0 ? Math.round((active7d / outcomesTotal) * 100) : null;

    return {
      date: now.toISOString(),
      period: { from: yesterday.toISOString(), to: now.toISOString() },
      signals: {
        total: signals24h,
        byDirection: signalsByDirection.reduce((acc, r) => {
          acc[r.signal] = r._count;
          return acc;
        }, {} as Record<string, number>),
        byStatus: signalsByStatus.reduce((acc, r) => {
          acc[r.status] = r._count;
          return acc;
        }, {} as Record<string, number>),
        top: topSignals,
      },
      scans: {
        total: scanHistory24h.length,
        recent: scanHistory24h,
      },
      portfolio: {
        totalValue: portfolioStats._sum.currentCapital ?? 0,
        openPositions: positions.length,
        positions,
      },
      performance: {
        winRate,
        totalOutcomes: outcomesTotal,
        wins: active7d,
        losses,
      },
      system: {
        users: userCount,
        activeStrategies,
        cronHealth,
        containers: containerStats,
      },
    };
  }

  private buildSummary(data: any): string {
    const dir = data.signals.byDirection;
    const buy = dir['BUY'] ?? 0;
    const sell = dir['SELL'] ?? 0;
    const neutral = dir['NEUTRAL'] ?? 0;
    const winRate = data.performance.winRate;
    const portfolioValue = data.portfolio.totalValue;

    return `Rapport du ${new Date(data.date).toLocaleDateString('fr-FR')} — ` +
      `${data.signals.total} signaux (${buy} BUY, ${sell} SELL, ${neutral} NEUTRAL), ` +
      `${data.scans.total} scans, ` +
      `${data.portfolio.openPositions} positions ouvertes` +
      (portfolioValue ? `, portefeuille: $${portfolioValue.toFixed(2)}` : '') +
      (winRate !== null ? `, win rate 7j: ${winRate}%` : '') +
      `, ${data.system.users} utilisateurs, ${data.system.activeStrategies} stratégies actives.`;
  }

  private buildInterpretation(data: any): string {
    const parts: string[] = [];
    const dir = data.signals.byDirection;
    const buy = dir['BUY'] ?? 0;
    const sell = dir['SELL'] ?? 0;
    const total = data.signals.total;

    if (total === 0) {
      parts.push('Aucun signal généré dans les dernières 24h — vérifier que les scans tournent.');
    } else {
      const buyRatio = buy / total;
      const sellRatio = sell / total;

      if (buyRatio > 0.6) {
        parts.push(`Sentiment global haussier (${Math.round(buyRatio * 100)}% BUY) — marché potentiellement en tendance bullish.`);
      } else if (sellRatio > 0.6) {
        parts.push(`Sentiment global baissier (${Math.round(sellRatio * 100)}% SELL) — marché potentiellement en tendance bearish.`);
      } else {
        parts.push(`Sentiment mixte (${buy} BUY vs ${sell} SELL) — marché en range ou indécis.`);
      }

      if (data.signals.top.length > 0) {
        const top = data.signals.top[0];
        const sym = top.asset?.symbol ?? top.symbol ?? 'N/A';
        parts.push(`Meilleur signal: ${sym} ${top.signal} (${top.confidence}% confiance, ${top.timeframe}).`);
      }
    }

    if (data.performance.winRate !== null) {
      if (data.performance.winRate >= 60) {
        parts.push(`Performance 7j positive (${data.performance.winRate}% win rate) — stratégies efficaces.`);
      } else if (data.performance.winRate < 40) {
        parts.push(`Performance 7j faible (${data.performance.winRate}% win rate) — considérer recalibrer les stratégies.`);
      } else {
        parts.push(`Performance 7j neutre (${data.performance.winRate}% win rate).`);
      }
    }

    if (data.portfolio.openPositions > 0) {
      const profitable = data.portfolio.positions.filter((p: any) => (p.pnl ?? 0) > 0).length;
      parts.push(`${data.portfolio.openPositions} positions ouvertes dont ${profitable} en profit.`);
    }

    if (data.system.cronHealth) {
      const failedCrons = Object.entries(data.system.cronHealth).filter(
        ([, v]: any) => v.lastStatus === 'failed',
      );
      if (failedCrons.length > 0) {
        parts.push(`Attention: ${failedCrons.length} cron(s) en échec — ${failedCrons.map(([k]) => k).join(', ')}.`);
      }
    }

    return parts.join(' ');
  }

  private async getSystemHealth(): Promise<any> {
    try {
      const { stdout } = await execAsync(
        'docker ps --format "{{.Names}}\t{{.Status}}" 2>/dev/null | grep trading-os',
        { timeout: 3000 },
      );
      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, status] = line.split('\t');
        return { name, status };
      });
    } catch {
      return [];
    }
  }

  private async getContainerStats(): Promise<any> {
    const mem = process.memoryUsage();
    return {
      api: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        uptime: Math.floor(process.uptime()),
      },
    };
  }

  generateReportHtml(report: any): string {
    const data = report.data;
    const date = new Date(report.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const dir = data.signals?.byDirection ?? {};
    const buy = dir['BUY'] ?? 0;
    const sell = dir['SELL'] ?? 0;
    const neutral = dir['NEUTRAL'] ?? 0;
    const total = data.signals?.total ?? 0;
    const winRate = data.performance?.winRate;
    const portfolioValue = data.portfolio?.totalValue;

    const topSignalsRows = (data.signals?.top ?? []).map((s: any) => {
      const sym = s.asset?.symbol ?? '—';
      const color = s.signal === 'BUY' ? '#34d399' : '#f87171';
      return `<tr><td>${sym}</td><td style="color:${color};font-weight:bold">${s.signal}</td><td>${Math.round(s.confidence)}%</td><td>${s.timeframe}</td><td>${s.status ?? ''}</td></tr>`;
    }).join('');

    const scanRows = (data.scans?.recent ?? []).slice(0, 15).map((s: any) => {
      const color = s.signal === 'BUY' ? '#34d399' : s.signal === 'SELL' ? '#f87171' : '#9ca3af';
      return `<tr><td>${s.symbol}</td><td style="color:${color}">${s.signal}</td><td>${s.confidence}%</td><td>${s.timeframe}</td><td>${s.strategyName}</td><td>${new Date(s.scannedAt).toLocaleTimeString('fr-FR')}</td></tr>`;
    }).join('');

    const positionRows = (data.portfolio?.positions ?? []).map((p: any) => {
      const sym = p.asset?.symbol ?? '—';
      const pnlColor = (p.pnl ?? 0) >= 0 ? '#34d399' : '#f87171';
      return `<tr><td>${sym}</td><td>${p.direction}</td><td>${Number(p.entryPrice).toFixed(4)}</td><td style="color:${pnlColor}">${Number(p.pnl ?? 0).toFixed(2)}</td><td style="color:${pnlColor}">${Number(p.pnlPercent ?? 0).toFixed(1)}%</td></tr>`;
    }).join('');

    const containerRows = (data.system?.cronHealth ?? []).map((c: any) =>
      `<tr><td>${c.name}</td><td style="color:${c.status?.includes('Up') ? '#34d399' : '#f87171'}">${c.status}</td></tr>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport Trading OS — ${date}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #111827; color: #e5e7eb; padding: 40px; }
  h1 { color: #fff; font-size: 24px; margin-bottom: 4px; }
  h2 { color: #9ca3af; font-size: 14px; margin: 24px 0 12px; border-bottom: 1px solid #374151; padding-bottom: 8px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 24px; }
  .interpretation { background: #064e3b; border: 1px solid #065f46; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .interpretation h3 { color: #34d399; font-size: 13px; margin-bottom: 8px; }
  .interpretation p { color: #d1d5db; font-size: 13px; line-height: 1.6; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 12px 0; }
  .stat { background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 16px; text-align: center; }
  .stat .value { font-size: 24px; font-weight: bold; color: #fff; }
  .stat .label { font-size: 11px; color: #6b7280; margin-top: 4px; }
  .stat.buy .value { color: #34d399; }
  .stat.sell .value { color: #f87171; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
  th { text-align: left; color: #6b7280; padding: 8px; border-bottom: 1px solid #374151; font-size: 11px; }
  td { padding: 8px; border-bottom: 1px solid #1f2937; color: #d1d5db; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #374151; color: #4b5563; font-size: 11px; }
  @media print { body { background: #fff; color: #000; } .stat { border: 1px solid #ccc; } table th { border-bottom: 1px solid #ccc; } }
</style>
</head>
<body>
  <h1>Rapport Trading OS</h1>
  <p class="meta">${date} — Période: ${new Date(data.period?.from).toLocaleString('fr-FR')} → ${new Date(data.period?.to).toLocaleString('fr-FR')}</p>

  ${report.interpretation ? `<div class="interpretation"><h3>Interpretation</h3><p>${report.interpretation}</p></div>` : ''}

  <h2>Signaux (24h)</h2>
  <div class="stats">
    <div class="stat"><div class="value">${total}</div><div class="label">Total</div></div>
    <div class="stat buy"><div class="value">${buy}</div><div class="label">BUY</div></div>
    <div class="stat sell"><div class="value">${sell}</div><div class="label">SELL</div></div>
    <div class="stat"><div class="value">${neutral}</div><div class="label">NEUTRAL</div></div>
  </div>

  ${topSignalsRows ? `<h2>Top 10 signaux</h2><table><thead><tr><th>Symbole</th><th>Signal</th><th>Confiance</th><th>TF</th><th>Statut</th></tr></thead><tbody>${topSignalsRows}</tbody></table>` : ''}

  ${winRate !== null && winRate !== undefined ? `<h2>Performance (7j)</h2><div class="stats">
    <div class="stat"><div class="value" style="color:${winRate >= 50 ? '#34d399' : '#f87171'}">${winRate}%</div><div class="label">Win Rate</div></div>
    <div class="stat"><div class="value">${data.performance?.wins ?? 0}</div><div class="label">Actifs</div></div>
    <div class="stat"><div class="value">${data.performance?.losses ?? 0}</div><div class="label">Invalides</div></div>
  </div>` : ''}

  <h2>Portefeuille</h2>
  <div class="stats">
    <div class="stat"><div class="value">$${Number(portfolioValue ?? 0).toFixed(2)}</div><div class="label">Valeur totale</div></div>
    <div class="stat"><div class="value">${data.portfolio?.openPositions ?? 0}</div><div class="label">Positions ouvertes</div></div>
  </div>
  ${positionRows ? `<table><thead><tr><th>Symbole</th><th>Direction</th><th>Entrée</th><th>PnL</th><th>PnL %</th></tr></thead><tbody>${positionRows}</tbody></table>` : ''}

  ${scanRows ? `<h2>Scans récents (24h)</h2><table><thead><tr><th>Symbole</th><th>Signal</th><th>Confiance</th><th>TF</th><th>Stratégie</th><th>Heure</th></tr></thead><tbody>${scanRows}</tbody></table>` : ''}

  <h2>Système</h2>
  <div class="stats">
    <div class="stat"><div class="value">${data.system?.users ?? 0}</div><div class="label">Utilisateurs</div></div>
    <div class="stat"><div class="value">${data.system?.activeStrategies ?? 0}</div><div class="label">Stratégies actives</div></div>
    ${data.system?.containers?.api ? `<div class="stat"><div class="value">${data.system.containers.api.rss} MB</div><div class="label">API RSS</div></div>` : ''}
  </div>
  ${containerRows ? `<table><thead><tr><th>Conteneur</th><th>Statut</th></tr></thead><tbody>${containerRows}</tbody></table>` : ''}

  <div class="footer">Généré automatiquement par Trading OS — ${new Date().toISOString()}</div>
</body>
</html>`;
  }
}
