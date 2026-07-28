import type { jsPDF } from 'jspdf';

export type PerformanceStats = {
  closedCount: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number | 'Infinity';
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  maxDrawdown: number;
};

export type PositionRow = {
  asset?: { symbol?: string };
  direction?: string;
  status?: string;
  entryPrice?: string | number;
  exitPrice?: string | number | null;
  pnl?: string | number | null;
  pnlPercent?: string | number | null;
  openedAt?: string;
  closedAt?: string | null;
};

export async function downloadPerformancePDF(
  stats: PerformanceStats,
  positions: PositionRow[],
  filename = 'rapport-performance.pdf',
) {
  const { jsPDF } = await import('jspdf');
  await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const title = 'Rapport de performance';
  doc.setFontSize(18);
  doc.setTextColor(16, 185, 129);
  doc.text(title, 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 14, 28);

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  const metrics = [
    ['Trades clôturés', String(stats.closedCount)],
    ['Win rate', `${(typeof stats.winRate === 'number' ? stats.winRate : 0).toFixed(1)}%`],
    ['P&L total', `${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)} $`],
    ['Profit Factor', stats.profitFactor === Infinity || stats.profitFactor === 'Infinity' ? '∞' : Number(stats.profitFactor).toFixed(2)],
    ['Gain magn', stats.avgWin.toFixed(2)],
    ['Perte moy', stats.avgLoss.toFixed(2)],
    ['Expectancy', `${stats.expectancy.toFixed(2)} $`],
    ['Max drawdown', `${stats.maxDrawdown.toFixed(2)} $`],
  ];

  (doc as any).autoTable({
    startY: 36,
    head: [['Métrique', 'Valeur']],
    body: metrics,
    theme: 'grid',
    headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255] },
    styles: { fontSize: 10 },
    margin: { left: 14, right: 14 },
  });

  if (positions.length > 0) {
    const rows = positions.map(p => [
      p.asset?.symbol ?? '—',
      p.direction ?? '—',
      p.status ?? '—',
      p.entryPrice ?? '—',
      p.exitPrice ?? '—',
      p.pnl !== null && p.pnl !== undefined ? Number(p.pnl).toFixed(2) : '—',
      p.pnlPercent !== null && p.pnlPercent !== undefined ? `${Number(p.pnlPercent).toFixed(2)}%` : '—',
      p.openedAt ? new Date(p.openedAt).toLocaleDateString('fr-FR') : '—',
      p.closedAt ? new Date(p.closedAt).toLocaleDateString('fr-FR') : '—',
    ]);

    (doc as any).autoTable({
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Symbole', 'Direction', 'Statut', 'Entry', 'Exit', 'P&L', 'P&L %', 'Ouvert', 'Clôturé']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255] },
      styles: { fontSize: 8, cellPadding: 1.5 },
      margin: { left: 14, right: 14 },
    });
  }

  doc.save(filename);
}
