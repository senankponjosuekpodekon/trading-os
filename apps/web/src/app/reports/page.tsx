'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { FileText, TrendingUp, TrendingDown, Minus, Activity, Wallet, Cpu, Download, ChevronRight, Brain, RefreshCw } from 'lucide-react';

export default function ReportsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports-list'],
    queryFn: async () => {
      const { data } = await api.get('/reports?limit=30');
      return data;
    },
  });

  const { data: reportDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['report-detail', selectedId],
    queryFn: async () => {
      const { data } = await api.get(`/reports/${selectedId}`);
      return data;
    },
    enabled: !!selectedId,
  });

  const { data: latestReport } = useQuery({
    queryKey: ['report-latest'],
    queryFn: async () => {
      const { data } = await api.get('/reports/latest');
      return data;
    },
  });

  const queryClient = useQueryClient();
  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/reports/generate');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports-list'] });
      queryClient.invalidateQueries({ queryKey: ['report-latest'] });
    },
  });

  const displayReport = selectedId ? reportDetail : latestReport;
  const displayLoading = selectedId ? detailLoading : isLoading;

  return (
    <AppLayout title="Rapports quotidiens">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Rapports quotidiens</h1>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="ml-auto flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
            {generateMutation.isPending ? 'Génération...' : 'Générer maintenant'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Report list */}
          <div className="lg:col-span-1 space-y-2">
            <h2 className="text-sm font-medium text-gray-400 mb-2">Historique (30 derniers)</h2>
            {isLoading ? (
              <div className="text-gray-400 text-sm">Chargement...</div>
            ) : reports?.length === 0 ? (
              <div className="text-gray-500 text-sm p-4 bg-gray-900 border border-gray-800 rounded-xl">
                Aucun rapport généré pour le moment. Le premier rapport sera créé automatiquement à 6h00 UTC.
              </div>
            ) : (
              reports?.map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    selectedId === r.id
                      ? 'bg-emerald-950 border-emerald-700'
                      : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      {new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  </div>
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{r.summary}</p>
                </button>
              ))
            )}
          </div>

          {/* Report detail */}
          <div className="lg:col-span-2">
            {displayLoading ? (
              <div className="text-gray-400 text-sm">Chargement du rapport...</div>
            ) : !displayReport ? (
              <div className="text-gray-500 text-sm p-8 bg-gray-900 border border-gray-800 rounded-xl text-center">
                Sélectionnez un rapport ou attendez le premier rapport automatique.
              </div>
            ) : (
              <ReportDetail report={displayReport} />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function ReportDetail({ report }: { report: any }) {
  const data = report.data;
  if (!data) return <div className="text-gray-400">Données indisponibles</div>;

  const dir = data.signals?.byDirection ?? {};
  const buy = dir['BUY'] ?? 0;
  const sell = dir['SELL'] ?? 0;
  const neutral = dir['NEUTRAL'] ?? 0;
  const total = data.signals?.total ?? 0;
  const winRate = data.performance?.winRate;
  const portfolioValue = data.portfolio?.totalValue;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">
            Rapport du {new Date(report.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Période: {new Date(data.period?.from).toLocaleString('fr-FR')} — {new Date(data.period?.to).toLocaleString('fr-FR')}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg transition-colors"
        >
          <Download className="w-4 h-4" />
          Exporter PDF
        </button>
      </div>

      {/* Interpretation */}
      {report.interpretation && (
        <div className="flex items-start gap-3 p-4 bg-emerald-950/50 border border-emerald-800/50 rounded-xl">
          <Brain className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-emerald-300 mb-1">Interpretation IA</h3>
            <p className="text-sm text-gray-300">{report.interpretation}</p>
          </div>
        </div>
      )}

      {/* Signal stats */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" /> Signaux (24h)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label="Total" value={total} icon={<Activity className="w-4 h-4" />} />
          <StatBox label="BUY" value={buy} icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} color="emerald" />
          <StatBox label="SELL" value={sell} icon={<TrendingDown className="w-4 h-4 text-red-400" />} color="red" />
          <StatBox label="NEUTRAL" value={neutral} icon={<Minus className="w-4 h-4 text-gray-400" />} />
        </div>
      </div>

      {/* Performance */}
      {winRate !== null && winRate !== undefined && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Performance (7j)
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="Win Rate" value={`${winRate}%`} icon={<TrendingUp className="w-4 h-4" />} color={winRate >= 50 ? 'emerald' : 'red'} />
            <StatBox label="Actifs" value={data.performance?.wins ?? 0} icon={<Activity className="w-4 h-4" />} />
            <StatBox label="Invalides" value={data.performance?.losses ?? 0} icon={<TrendingDown className="w-4 h-4" />} />
          </div>
        </div>
      )}

      {/* Portfolio */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
          <Wallet className="w-4 h-4" /> Portefeuille
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatBox label="Valeur totale" value={`$${Number(portfolioValue ?? 0).toFixed(2)}`} icon={<Wallet className="w-4 h-4" />} />
          <StatBox label="Positions ouvertes" value={data.portfolio?.openPositions ?? 0} icon={<Activity className="w-4 h-4" />} />
        </div>
        {data.portfolio?.positions?.length > 0 && (
          <div className="mt-3 bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2">Symbole</th>
                  <th className="text-left">Direction</th>
                  <th className="text-right">Entrée</th>
                  <th className="text-right">PnL</th>
                  <th className="text-right">PnL %</th>
                </tr>
              </thead>
              <tbody>
                {data.portfolio.positions.map((p: any, i: number) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <td className="py-2 text-white">{p.symbol}</td>
                    <td className="text-gray-300">{p.direction}</td>
                    <td className="text-right text-gray-300">{Number(p.entryPrice).toFixed(4)}</td>
                    <td className={`text-right ${(p.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {Number(p.pnl ?? 0).toFixed(2)}
                    </td>
                    <td className={`text-right ${(p.pnlPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {Number(p.pnlPercent ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top signals */}
      {data.signals?.top?.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Top 10 signaux
          </h3>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2">Symbole</th>
                  <th className="text-left">Signal</th>
                  <th className="text-right">Confiance</th>
                  <th className="text-left">TF</th>
                  <th className="text-left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {data.signals.top.map((s: any, i: number) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <td className="py-2 text-white">{s.asset?.symbol ?? s.symbol ?? '—'}</td>
                    <td className={s.signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{s.signal}</td>
                    <td className="text-right text-gray-300">{Number(s.confidence).toFixed(0)}%</td>
                    <td className="text-gray-300">{s.timeframe}</td>
                    <td className="text-gray-400 text-xs">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent scans */}
      {data.scans?.recent?.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4" /> Scans récents (24h)
          </h3>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2">Symbole</th>
                  <th className="text-left">Signal</th>
                  <th className="text-right">Confiance</th>
                  <th className="text-left">TF</th>
                  <th className="text-left">Stratégie</th>
                  <th className="text-right">Heure</th>
                </tr>
              </thead>
              <tbody>
                {data.scans.recent.slice(0, 15).map((s: any, i: number) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <td className="py-2 text-white">{s.symbol}</td>
                    <td className={s.signal === 'BUY' ? 'text-emerald-400' : s.signal === 'SELL' ? 'text-red-400' : 'text-gray-400'}>
                      {s.signal}
                    </td>
                    <td className="text-right text-gray-300">{s.confidence}%</td>
                    <td className="text-gray-300">{s.timeframe}</td>
                    <td className="text-gray-400 text-xs">{s.strategyName}</td>
                    <td className="text-right text-gray-500 text-xs">
                      {new Date(s.scannedAt).toLocaleTimeString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* System */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4" /> Système
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label="Utilisateurs" value={data.system?.users ?? 0} icon={<Activity className="w-4 h-4" />} />
          <StatBox label="Stratégies actives" value={data.system?.activeStrategies ?? 0} icon={<Cpu className="w-4 h-4" />} />
          {data.system?.containers?.api && (
            <StatBox label="API RSS" value={`${data.system.containers.api.rss} MB`} icon={<Cpu className="w-4 h-4" />} />
          )}
          {data.system?.containers?.api && (
            <StatBox label="API Uptime" value={`${Math.floor(data.system.containers.api.uptime / 60)}m`} icon={<Activity className="w-4 h-4" />} />
          )}
        </div>
      </div>

      {/* Docker containers */}
      {data.system?.cronHealth?.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Conteneurs Docker</h3>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
            {data.system.cronHealth.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{c.name}</span>
                <span className={`text-xs ${c.status?.includes('Up') ? 'text-emerald-400' : 'text-red-400'}`}>{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, icon, color }: { label: string; value: number | string; icon: React.ReactNode; color?: string }) {
  const colorClass = color === 'emerald' ? 'text-emerald-400' : color === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl">
      <div className="text-gray-500">{icon}</div>
      <p className={`text-xl font-bold ${colorClass}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
