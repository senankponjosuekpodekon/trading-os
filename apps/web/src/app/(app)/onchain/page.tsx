'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { Bitcoin, Cpu, Gauge, Wallet, TrendingUp, Database, Percent, Layers, Search, BookOpen, ChevronDown, Activity } from 'lucide-react';
import { api } from '@/lib/api';

interface BtcData {
  price: number;
  marketCap: number;
  transactions24h: number;
  mempoolSize: number;
  suggestedFee: number;
}

interface EthData {
  price: number;
  marketCap: number;
  transactions24h: number;
  gasPriceMedian: number;
}

function Metric({ label, value, sub, icon: Icon, color }: { label: string; value: React.ReactNode; sub?: string; icon: any; color: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg bg-gray-800 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-gray-500 text-xs">{label}</p>
        <p className="text-white font-mono font-semibold text-lg">{value}</p>
        {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const regimeStyle = (regime: string) => {
  switch (regime) {
    case 'RISK_ON_ALTS': return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300';
    case 'RISK_ON': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
    case 'SQUEEZE_RISK': return 'border-red-500/50 bg-red-500/10 text-red-300';
    case 'RISK_OFF': return 'border-orange-500/50 bg-orange-500/10 text-orange-300';
    default: return 'border-gray-600 bg-gray-800 text-gray-300';
  }
};

const impactColor = (impact: string) => {
  if (impact === 'bullish' || impact === 'alt_favorable') return 'text-emerald-400';
  if (impact === 'bearish' || impact === 'mild_bearish' || impact === 'btc_favorable') return 'text-red-400';
  return 'text-gray-400';
};

export default function OnChainPage() {
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [guideOpen, setGuideOpen] = useState(false);

  const { data: btc, isLoading: btcLoading } = useQuery<BtcData | null>({
    queryKey: ['on-chain-btc'],
    queryFn: async () => (await api.get('/market-data/on-chain/btc')).data,
    staleTime: 300_000,
  });
  const { data: eth, isLoading: ethLoading } = useQuery<EthData | null>({
    queryKey: ['on-chain-eth'],
    queryFn: async () => (await api.get('/market-data/on-chain/eth')).data,
    staleTime: 300_000,
  });

  const { data: btcDominance } = useQuery({
    queryKey: ['onchain-btc-dominance'],
    queryFn: async () => (await api.get('/onchain/btc-dominance')).data,
    staleTime: 300_000,
  });

  const { data: funding } = useQuery({
    queryKey: ['onchain-funding', symbol],
    queryFn: async () => (await api.get(`/onchain/funding/${encodeURIComponent(symbol)}`)).data,
    staleTime: 120_000,
  });

  const { data: basis } = useQuery({
    queryKey: ['onchain-spot-perp-basis', symbol],
    queryFn: async () => (await api.get(`/onchain/spot-perp-basis/${encodeURIComponent(symbol)}`)).data,
    staleTime: 120_000,
  });

  const { data: interp } = useQuery({
    queryKey: ['onchain-interpretation', symbol],
    queryFn: async () => (await api.get(`/onchain/market-interpretation?symbol=${encodeURIComponent(symbol)}`)).data,
    staleTime: 120_000,
  });

  const { data: undervalued } = useQuery({
    queryKey: ['onchain-undervalued'],
    queryFn: async () => (await api.get('/onchain/undervalued?limit=10')).data,
    staleTime: 600_000,
  });

  const { data: majors } = useQuery({
    queryKey: ['onchain-majors-trajectory'],
    queryFn: async () => (await api.get('/onchain/majors-trajectory?limit=10')).data,
    staleTime: 300_000,
  });

  if (btcLoading || ethLoading) {
    return (
      <>
        <PageSkeleton statCards={4} tableRows={0} />
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            On-chain Dashboard
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Indicateurs blockchain BTC et ETH en temps réel.</p>
        </div>

        {/* Lecture du marché — interprétation automatique */}
        {interp && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" /> Lecture du marché
              </h3>
              <span className={`px-3 py-1 rounded-md text-sm font-bold border ${regimeStyle(interp.regime)}`}>
                {interp.regime} · {interp.score > 0 ? '+' : ''}{interp.score}
              </span>
            </div>
            <p className="text-sm text-gray-300 mb-3">{interp.advice}</p>
            <div className="space-y-1.5">
              {(interp.signals ?? []).map((s: any, i: number) => (
                <div key={i} className={`text-xs flex items-start gap-2 ${impactColor(s.impact)}`}>
                  <span className="mt-0.5 w-16 shrink-0 text-gray-500 uppercase text-[10px]">{s.metric}</span>
                  {s.read}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Bitcoin className="w-4 h-4 text-orange-400" />
            Bitcoin
          </h3>
          {btc ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Metric label="Prix" value={`$${btc.price.toLocaleString('en-US')}`} icon={TrendingUp} color="text-orange-400" />
              <Metric label="Transactions 24h" value={btc.transactions24h.toLocaleString('en-US')} icon={Database} color="text-orange-400" />
              <Metric label="Mempool" value={btc.mempoolSize.toLocaleString('en-US')} sub="transactions en attente" icon={Wallet} color="text-orange-400" />
              <Metric label="Fee recommandée" value={`${btc.suggestedFee} sat/vB`} icon={Gauge} color="text-orange-400" />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">Données BTC indisponibles</div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            Ethereum
          </h3>
          {eth ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Metric label="Prix" value={`$${eth.price.toLocaleString('en-US')}`} icon={TrendingUp} color="text-indigo-400" />
              <Metric label="Transactions 24h" value={eth.transactions24h.toLocaleString('en-US')} icon={Database} color="text-indigo-400" />
              <Metric label="Gas median" value={`${eth.gasPriceMedian} gwei`} icon={Gauge} color="text-indigo-400" />
              <Metric label="Market cap" value={`$${(eth.marketCap / 1e9).toFixed(1)}B`} icon={Wallet} color="text-indigo-400" />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">Données ETH indisponibles</div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Percent className="w-4 h-4 text-yellow-400" /> BTC Dominance
          </h3>
          {btcDominance ? (
            <div className="grid grid-cols-2 gap-4">
              <Metric label="BTC Dominance" value={`${(btcDominance.dominance_pct ?? 0).toFixed(2)}%`} sub={btcDominance.timestamp ? new Date(btcDominance.timestamp).toLocaleString() : '—'} icon={Percent} color="text-yellow-400" />
              <Metric label="Dominance 24h" value={`${(btcDominance.change_24h_pct ?? 0).toFixed(2)}%`} icon={TrendingUp} color={btcDominance.change_24h_pct >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">BTC dominance unavailable</div>
          )}
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" /> Derivatives ({symbol})
          </h3>
          <div className="flex items-center gap-2 mb-4">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded px-3 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
              placeholder="BTC/USDT"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {funding ? (
              <div className="bg-gray-950 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Funding</p>
                <p className="text-white font-mono text-lg">{(funding.funding_rate ?? 0).toFixed(4)}%</p>
                <p className="text-xs text-gray-500">{funding.exchange || '—'} · {funding.interval || '8h'}</p>
              </div>
            ) : <div className="bg-gray-950 rounded-lg p-4 text-sm text-gray-500">Funding data unavailable</div>}
            {basis ? (
              <div className="bg-gray-950 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Spot-Perp Basis</p>
                <p className="text-white font-mono text-lg">{(basis.basis_pct ?? 0).toFixed(2)}%</p>
                <p className="text-xs text-gray-500">Spot ${(basis.spot_price ?? 0).toLocaleString()} · Perp ${(basis.perp_price ?? 0).toLocaleString()}</p>
              </div>
            ) : <div className="bg-gray-950 rounded-lg p-4 text-sm text-gray-500">Basis data unavailable</div>}
          </div>
        </section>

        {/* Protocoles sous-évalués — analyse auto façon coach (mcap/tvl, vol/mcap, 7j) */}
        {undervalued?.undervalued?.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Protocoles sous-évalués
            </h3>
            <p className="text-[11px] text-gray-500 mb-3">
              Score combinant mcap/tvl + volume/mcap + tendance 7j + dynamique TVL — {undervalued.scanned_count} protocoles DefiLlama scannés. Screening pour due diligence, pas un signal d&apos;achat.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="pb-2 pr-3">Protocole</th>
                    <th className="pb-2 pr-3">Score</th>
                    <th className="pb-2 pr-3">mcap/tvl</th>
                    <th className="pb-2 pr-3">vol/mcap</th>
                    <th className="pb-2 pr-3">7j</th>
                    <th className="pb-2 pr-3" title="Mcap du leader de la catégorie ÷ mcap du protocole — plafond théorique, pas une prédiction">Plafond</th>
                    <th className="pb-2">Lecture</th>
                  </tr>
                </thead>
                <tbody>
                  {undervalued.undervalued.map((p: any, i: number) => (
                    <tr key={i} className="border-b border-gray-800/50 align-top">
                      <td className="py-2 pr-3">
                        <span className="text-white font-medium">{p.symbol || p.name}</span>
                        <span className="text-gray-500 ml-1.5">{p.category}</span>
                      </td>
                      <td className={`py-2 pr-3 font-bold ${p.undervalued_score >= 70 ? 'text-emerald-400' : p.undervalued_score >= 50 ? 'text-yellow-400' : 'text-gray-400'}`}>
                        {p.undervalued_score}
                      </td>
                      <td className="py-2 pr-3 text-gray-300">{p.mcap_tvl}x</td>
                      <td className="py-2 pr-3 text-gray-300">{p.vol_mcap != null ? `${(p.vol_mcap * 100).toFixed(0)}%` : '—'}</td>
                      <td className={`py-2 pr-3 ${p.trend_7d_pct != null ? (p.trend_7d_pct >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500'}`}>
                        {p.trend_7d_pct != null ? `${p.trend_7d_pct > 0 ? '+' : ''}${p.trend_7d_pct}%` : '—'}
                      </td>
                      <td className={`py-2 pr-3 font-medium ${p.upside_x != null && p.upside_x >= 10 ? 'text-emerald-400' : 'text-gray-400'}`}>
                        {p.upside_x != null ? `~${p.upside_x}x` : '—'}
                      </td>
                      <td className="py-2 text-gray-400 max-w-md">{p.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Trajectoires majors — suivi longitudinal automatique */}
        {majors?.majors?.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" /> Trajectoires majors
            </h3>
            <p className="text-[11px] text-gray-500 mb-3">
              Snapshots toutes les 30 min — croissance prix/volume/mcap mesurée sur la série, pas juste la variation 24h. {majors.tracked_count} actifs suivis.
            </p>
            <div className="space-y-2">
              {majors.majors.map((m: any, i: number) => (
                <div key={i} className="flex items-start justify-between gap-3 text-xs bg-gray-950 rounded-lg p-3">
                  <div className="min-w-0">
                    <span className="text-white font-medium">{m.symbol}</span>
                    <span className="text-gray-500 ml-1.5">{m.name}</span>
                    <p className="text-gray-400 mt-0.5">{m.comment}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    {m.trajectory?.price_change_pct != null && (
                      <p className={m.trajectory.price_change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {m.trajectory.price_change_pct >= 0 ? '+' : ''}{m.trajectory.price_change_pct}% suivi
                      </p>
                    )}
                    {m.trajectory?.volume_trend_pct != null && (
                      <p className={m.trajectory.volume_trend_pct >= 0 ? 'text-cyan-400' : 'text-orange-400'}>
                        vol {m.trajectory.volume_trend_pct >= 0 ? '+' : ''}{m.trajectory.volume_trend_pct}%
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {majors?.status === 'collecting' && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-400">
            {majors.note}
          </section>
        )}

        {/* Guide d'exploitation — notice */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-white hover:bg-gray-800/50 transition"
          >
            <span className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-400" />
              Guide d&apos;exploitation — comment lire ces données et décider
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
          </button>
          {guideOpen && (
            <div className="px-5 pb-5 space-y-4 text-xs text-gray-400">
              <div>
                <p className="text-white font-medium mb-1">Funding rate (le plus actionnable)</p>
                <ul className="space-y-1 ml-3 list-disc">
                  <li><span className="text-red-400">&gt; +0.05%</span> → les longs paient les shorts : marché surchargé de longs → risque de squeeze baissier, méfiance sur les BUY.</li>
                  <li><span className="text-emerald-400">&lt; −0.01%</span> → shorts surpeuplés → carburant pour un squeeze haussier, BUY plus sûrs.</li>
                  <li>≈ 0% → positionnement équilibré, neutre.</li>
                </ul>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Spot-Perp Basis</p>
                <ul className="space-y-1 ml-3 list-disc">
                  <li>Perp nettement <span className="text-red-400">au-dessus</span> du spot (&gt;0.15%) → spéculation levier excessive → fragile.</li>
                  <li>Perp <span className="text-emerald-400">sous</span> le spot → peur ou accumulation spot — plus sain.</li>
                </ul>
              </div>
              <div>
                <p className="text-white font-medium mb-1">BTC Dominance — le timing altcoins</p>
                <ul className="space-y-1 ml-3 list-disc">
                  <li>Dominance <span className="text-emerald-400">qui baisse</span> → rotation vers les alts → fenêtre favorable pour hidden gems / moonshots.</li>
                  <li>Dominance <span className="text-red-400">qui monte</span> → fuite vers BTC → les alts souffrent, prudence.</li>
                </ul>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Mempool BTC & Gas ETH</p>
                <ul className="space-y-1 ml-3 list-disc">
                  <li>Mempool qui gonfle + fees élevées → congestion, demande de settlement → volatilité probable à court terme.</li>
                  <li>Gas ETH élevé (&gt;40 gwei) → activité on-chain réelle — soutien fondamental, pas juste spéculatif.</li>
                </ul>
              </div>
              <div className="pt-2 border-t border-gray-800">
                <p className="text-white font-medium mb-1">Règle de décision combinée</p>
                <p>Dominance BTC en baisse + funding neutre/négatif + gas ETH élevé = <span className="text-emerald-400">contexte risk-on alts</span>. Funding &gt;+0.05% + basis fort = <span className="text-red-400">marché surchargé de longs</span>, réduire la taille des positions. La carte « Lecture du marché » en haut synthétise tout ça automatiquement.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
