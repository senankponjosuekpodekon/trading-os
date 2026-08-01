'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Globe, FileText, Building2, LayoutList, BarChart3 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

interface BrvmQuote {
  symbol: string; name: string; price: number;
  change: number; change_pct: number; volume: number;
  signal?: string; confidence?: number; reasons?: string;
}

interface FundamentalScore {
  symbol: string;
  score: number;
  latest_report_type?: string;
  latest_report_date?: string;
  slug?: string;
}

function Pct({ v }: { v: number }) {
  const c = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-500';
  return <span className={`font-mono text-sm font-semibold ${c}`}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
}

export default function BrvmPage() {
  const [tab, setTab] = useState<'signals' | 'reports' | 'market' | 'all'>('signals');

  const { data: scan, isLoading, refetch } = useQuery({
    queryKey: ['brvm-scan'],
    queryFn: async () => (await api.post('/brvm/scan', {})).data,
    refetchInterval: 5 * 60_000,
  });

  const { data: movers } = useQuery({
    queryKey: ['brvm-movers'],
    queryFn: async () => (await api.get('/brvm/top-movers')).data,
    refetchInterval: 5 * 60_000,
  });

  const symbols = (scan?.results ?? []).map((r: BrvmQuote) => r.symbol);
  const { data: fScores } = useQuery({
    queryKey: ['brvm-fundamental', symbols],
    queryFn: async () => (await api.post('/brvm/reports/scores', symbols)).data as FundamentalScore[],
    enabled: symbols.length > 0,
    refetchInterval: 30 * 60_000,
  });

  const { data: issuers } = useQuery({
    queryKey: ['brvm-issuers'],
    queryFn: async () => (await api.get('/brvm/reports/issuers')).data as { code: string; name: string; slug: string; description?: string }[],
    enabled: tab === 'reports',
  });

  const results: BrvmQuote[] = scan?.results ?? [];
  const buys  = results.filter(r => r.signal === 'BUY');
  const sells = results.filter(r => r.signal === 'SELL');

  return (
    <AppLayout title="BRVM">
      <div className="space-y-5">
        {isLoading && !scan ? (
          <PageSkeleton statCards={4} tableRows={6} />
        ) : (
        <>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-white font-semibold">Bourse Régionale des Valeurs Mobilières</h2>
              <p className="text-gray-500 text-xs">UEMOA — cotations en XOF
                {scan && <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${scan.source === 'live' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                  {scan.source === 'live' ? '⬤ Live' : '◎ Demo'}
                </span>}
              </p>
            </div>
          </div>
          <button onClick={() => refetch()} disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Actualiser
          </button>
        </div>

        {/* Statistiques */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Titres suivis',   value: results.length },
            { label: 'Signaux BUY',     value: buys.length,  color: 'text-emerald-400' },
            { label: 'Signaux SELL',    value: sells.length, color: 'text-red-400' },
            { label: 'Source données',  value: scan?.source === 'live' ? 'Live' : 'Demo' },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-xl font-bold ${s.color ?? 'text-white'}`}>{s.value ?? '…'}</p>
            </div>
          ))}
        </div>

        {/* Onglets */}
        <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-2">
          {[
            { id: 'signals', label: 'Signaux', icon: TrendingUp },
            { id: 'reports', label: 'Rapports', icon: FileText },
            { id: 'market',  label: 'Marché',  icon: BarChart3 },
            { id: 'all',     label: 'Tous les titres', icon: LayoutList },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'text-emerald-400 border-b-2 border-emerald-400 bg-gray-800/50'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />{t.label}
            </button>
          ))}
        </div>

        {tab === 'signals' && (
          <div className="space-y-5">
            {/* Signaux actifs BUY / SELL */}
            {(buys.length > 0 || sells.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {buys.map(q => (
                  <div key={q.symbol} className="bg-gray-900 border border-emerald-500/30 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-white font-bold">{q.symbol}</p>
                        <p className="text-gray-500 text-xs">{q.name}</p>
                      </div>
                      <span className="flex items-center gap-1 text-emerald-400 text-sm font-bold"><TrendingUp className="w-4 h-4"/>BUY</span>
                    </div>
                    <p className="text-emerald-400 font-mono text-sm">{q.price.toLocaleString()} XOF</p>
                    <p className="text-gray-400 text-xs mt-1">{q.reasons}</p>
                  </div>
                ))}
                {sells.map(q => (
                  <div key={q.symbol} className="bg-gray-900 border border-red-500/30 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-white font-bold">{q.symbol}</p>
                        <p className="text-gray-500 text-xs">{q.name}</p>
                      </div>
                      <span className="flex items-center gap-1 text-red-400 text-sm font-bold"><TrendingDown className="w-4 h-4"/>SELL</span>
                    </div>
                    <p className="text-red-400 font-mono text-sm">{q.price.toLocaleString()} XOF</p>
                    <p className="text-gray-400 text-xs mt-1">{q.reasons}</p>
                  </div>
                ))}
              </div>
            )}

            {buys.length === 0 && sells.length === 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
                Aucun signal actif pour le moment. Les décisions BRVM sont souvent mensuelles/trimestrielles, liées aux publications de rapports.
              </div>
            )}

            {/* Stratégies disponibles */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Stratégies BRVM disponibles</h3>
              <ul className="text-gray-400 text-xs space-y-1 list-disc list-inside">
                <li><strong className="text-gray-300">Momentum + volume :</strong> signaux BUY/SELL sur les variations fortes accompagnées de volume.</li>
                <li><strong className="text-gray-300">Event-driven :</strong> privilégier les titres ayant publié un rapport récemment (effet annonce).</li>
                <li><strong className="text-gray-300">Mixte :</strong> un titre avec momentum positif + rapport récent voit son score et sa confiance augmentés.</li>
              </ul>
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <div className="space-y-5">
            {/* Fraîcheur des rapports émetteurs */}
            {fScores && fScores.some((s: FundamentalScore) => s.score > 0) && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />Boost fondamental actif
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {fScores.filter((s: FundamentalScore) => s.score > 0).map((s: FundamentalScore) => (
                    <div key={s.symbol} className="bg-gray-800/50 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-bold text-sm">{s.symbol}</span>
                        <span className="text-xs font-mono text-blue-300">+{s.score}</span>
                      </div>
                      <p className="text-gray-500 text-xs mt-1">
                        {s.latest_report_type?.toLowerCase().replace('_', ' ')} — {s.latest_report_date ? new Date(s.latest_report_date).toLocaleDateString('fr-FR') : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Liste des émetteurs */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />Émetteurs BRVM
                </h3>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-gray-800 bg-gray-900">
                    {['Code', 'Émetteur', 'Description'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {!issuers && (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-600 text-xs">
                      <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Chargement…
                    </td></tr>
                  )}
                  {issuers?.map(i => (
                    <tr key={i.slug} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2 text-gray-400 font-mono text-xs">{i.code}</td>
                      <td className="px-4 py-2 text-white text-xs font-medium">{i.name}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs truncate max-w-xs">{i.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'market' && movers && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />Top hausses
              </h3>
              <div className="space-y-2">
                {movers.top_gainers?.slice(0, 5).map((q: BrvmQuote) => (
                  <div key={q.symbol} className="flex items-center justify-between">
                    <div><p className="text-white text-sm font-medium">{q.symbol}</p><p className="text-gray-500 text-xs">{q.name}</p></div>
                    <div className="text-right">
                      <p className="text-white text-sm font-mono">{q.price.toLocaleString()} XOF</p>
                      <Pct v={q.change_pct} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5" />Top baisses
              </h3>
              <div className="space-y-2">
                {movers.top_losers?.slice(0, 5).reverse().map((q: BrvmQuote) => (
                  <div key={q.symbol} className="flex items-center justify-between">
                    <div><p className="text-white text-sm font-medium">{q.symbol}</p><p className="text-gray-500 text-xs">{q.name}</p></div>
                    <div className="text-right">
                      <p className="text-white text-sm font-mono">{q.price.toLocaleString()} XOF</p>
                      <Pct v={q.change_pct} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'all' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-gray-800 bg-gray-900">
                {['Symbole', 'Nom', 'Prix (XOF)', 'Variation', 'Volume', 'Signal', 'Raisons'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-600">
                  <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Chargement BRVM…
                </td></tr>
              )}
              {results.map(q => (
                <tr key={q.symbol} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-bold text-white">{q.symbol}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs max-w-32 truncate">{q.name}</td>
                  <td className="px-4 py-3 font-mono text-white">{q.price.toLocaleString()}</td>
                  <td className="px-4 py-3"><Pct v={q.change_pct} /></td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{q.volume.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {q.signal === 'BUY'  && <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold"><TrendingUp className="w-3 h-3"/>BUY</span>}
                    {q.signal === 'SELL' && <span className="flex items-center gap-1 text-red-400 text-xs font-bold"><TrendingDown className="w-3 h-3"/>SELL</span>}
                    {q.signal === 'WATCH' && <span className="flex items-center gap-1 text-gray-500 text-xs"><Minus className="w-3 h-3"/>WATCH</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-48 truncate" title={q.reasons}>{q.reasons ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </div>
        )}
        </>
        )}
      </div>
    </AppLayout>
  );
}
