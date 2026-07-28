'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Portfolio, PortfolioSummary } from '@/types';
import {
  ShieldAlert, TrendingDown, Wallet, Activity, AlertTriangle,
  Briefcase, ArrowRight, CheckCircle2
} from 'lucide-react';

export default function RiskPage() {
  const [selectedId, setSelectedId] = useState<string>('ALL');

  const { data: portfolios } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => (await api.get('/portfolios')).data,
  });

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ['positions-summary', selectedId],
    queryFn: async () => (await api.get(`/positions/summary?portfolioId=${selectedId}`)).data,
    enabled: !!portfolios,
  });

  const portfolio = portfolios?.find(p => p.id === selectedId);

  const analysis = useMemo(() => {
    if (!summary) return null;
    const positions = summary.positions ?? [];
    const open = positions.filter(p => p.status === 'OPEN' || p.status === 'PARTIAL');
    const capital = parseFloat(portfolio?.currentCapital ?? summary.totalPnl?.toString() ?? '0');

    const exposure = open.reduce((sum, p) => {
      const qty = parseFloat(p.quantity ?? '0');
      const price = parseFloat(p.entryPrice ?? '0');
      return sum + qty * price;
    }, 0);

    const exposurePct = capital > 0 ? (exposure / capital) * 100 : 0;

    const baseCount = new Map<string, number>();
    open.forEach(p => {
      const base = p.asset?.symbol?.split('/')[0] ?? 'UNKNOWN';
      baseCount.set(base, (baseCount.get(base) || 0) + 1);
    });
    const correlated = Array.from(baseCount.entries())
      .filter(([, count]) => count >= 3)
      .map(([base]) => base);

    const maxRiskPerTrade = open.map(p => {
      const qty = parseFloat(p.quantity ?? '0');
      const entry = parseFloat(p.entryPrice ?? '0');
      const sl = p.stopLoss ? parseFloat(p.stopLoss) : entry * 0.95;
      const risk = Math.abs(entry - sl) * qty;
      return { symbol: p.asset?.symbol ?? '—', riskPct: capital > 0 ? (risk / capital) * 100 : 0, risk };
    }).sort((a, b) => b.riskPct - a.riskPct);

    return {
      openCount: open.length,
      exposure,
      exposurePct,
      correlated,
      maxRiskPerTrade,
      dailyLossPct: capital > 0 && portfolio?.currentCapital && portfolio?.initialCapital
        ? Math.min(0, ((parseFloat(portfolio.currentCapital) - parseFloat(portfolio.initialCapital)) / parseFloat(portfolio.initialCapital)) * 100)
        : 0,
    };
  }, [summary, portfolio]);

  return (
    <AppLayout title="Risk Management">
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-emerald-400" />Risk Dashboard
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Exposition, corrélations et contrôle du risque</p>
          </div>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">Tous les portfolios</option>
            {portfolios?.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
            ))}
          </select>
        </div>

        {!analysis ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 h-28 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <RiskCard
                label="Positions ouvertes"
                value={String(analysis.openCount)}
                sub={analysis.openCount > 5 ? 'Concentration élevée' : 'OK'}
                trend={analysis.openCount > 5 ? 'down' : 'up'}
                icon={<Briefcase className="w-4 h-4" />}
              />
              <RiskCard
                label="Exposition totale"
                value={`$${analysis.exposure.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                sub={`${analysis.exposurePct.toFixed(1)}% du capital`}
                trend={analysis.exposurePct > 30 ? 'down' : 'up'}
                icon={<Wallet className="w-4 h-4" />}
              />
              <RiskCard
                label="P&L réalisé"
                value={`${(summary?.totalPnl ?? 0) >= 0 ? '+' : ''}$${(summary?.totalPnl ?? 0).toFixed(2)}`}
                sub={`Win rate ${(summary?.winRate ?? 0).toFixed(1)}%`}
                trend={(summary?.totalPnl ?? 0) >= 0 ? 'up' : 'down'}
                icon={<Activity className="w-4 h-4" />}
              />
              <RiskCard
                label="Max risque / trade"
                value={`${analysis.maxRiskPerTrade[0]?.riskPct.toFixed(2) ?? '0.00'}%`}
                sub={analysis.maxRiskPerTrade[0]?.symbol ?? '—'}
                trend={analysis.maxRiskPerTrade[0]?.riskPct && analysis.maxRiskPerTrade[0].riskPct > 2 ? 'down' : 'up'}
                icon={<TrendingDown className="w-4 h-4" />}
              />
            </div>

            {analysis.correlated.length > 0 && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-400">Alerte corrélation</p>
                  <p className="text-xs text-yellow-400/80 mt-0.5">
                    Tu as 3+ positions ouvertes sur des actifs corrélés : {analysis.correlated.join(', ')}.
                    Le risque réel est supérieur au risque apparent.
                  </p>
                </div>
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-emerald-400" />Positions ouvertes — risque par trade
              </h3>
              {analysis.maxRiskPerTrade.length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-sm">Aucune position ouverte</div>
              ) : (
                <div className="space-y-3">
                  {analysis.maxRiskPerTrade.map((item, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <span className="text-sm text-gray-400 w-24 shrink-0">{item.symbol}</span>
                      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${item.riskPct > 2 ? 'bg-red-400' : 'bg-emerald-400'}`}
                          style={{ width: `${Math.min(100, item.riskPct * 20)}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono w-20 text-right text-white">{item.riskPct.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />Règles de risque
                </h3>
                <ul className="space-y-2 text-sm text-gray-400">
                  <Rule ok={analysis.openCount <= 5} text="Max 5 positions ouvertes simultanées" />
                  <Rule ok={analysis.exposurePct <= 30} text="Exposition totale ≤ 30% du capital" />
                  <Rule ok={analysis.maxRiskPerTrade[0]?.riskPct ? analysis.maxRiskPerTrade[0].riskPct <= 2 : true} text="Risque par trade ≤ 2% du capital" />
                  <Rule ok={analysis.correlated.length === 0} text="Pas plus de 2 positions corrélées" />
                </ul>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-3">Recommandation</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {analysis.openCount === 0
                    ? 'Aucune exposition. Le marché attend ton prochain setup.'
                    : analysis.exposurePct > 30 || analysis.correlated.length > 0
                    ? 'Réduis l\'exposition ou diversifie les bases de corrélations avant d\'ajouter une nouvelle position.'
                    : analysis.maxRiskPerTrade[0]?.riskPct && analysis.maxRiskPerTrade[0].riskPct > 2
                    ? 'Au moins une position dépasse 2% de risque. Vérifie le sizing ou le stop loss.'
                    : 'Profil de risque globalement sain.'}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function RiskCard({ label, value, sub, trend, icon }: { label: string; value: string; sub: string; trend: 'up' | 'down'; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400">{label}</p>
        <span className={`${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className={`text-xs mt-1 ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>{sub}</p>
    </div>
  );
}

function Rule({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className={ok ? 'text-gray-300' : 'text-red-400'}>{text}</span>
    </li>
  );
}
