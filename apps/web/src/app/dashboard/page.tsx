'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Briefcase, Activity, ArrowUpRight, ArrowDownRight, Zap, BookOpen, Brain, BarChart2, Globe, Cpu, Smile, Banknote, Calendar, Database, Scale, Layers, Users } from 'lucide-react';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/store/auth.store';
import { useTradingStore } from '@/store/trading.store';
import { api } from '@/lib/api';
import { Portfolio, Signal, PortfolioSummary, ExpectedMoveResponse } from '@/types';
import Link from 'next/link';
import { ExpectedMoveWidget } from './_components/ExpectedMoveWidget';

function StatCard({ label, value, sub, trend, icon }: { label: string; value: string | React.ReactNode; sub?: string; trend?: 'up' | 'down' | 'neutral'; icon?: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400">{label}</p>
        {icon && <span className="text-gray-600">{icon}</span>}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && (
        <div className={`flex items-center gap-1 mt-1 text-xs ${trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-gray-500'}`}>
          {trend === 'up' && <ArrowUpRight className="w-3 h-3" />}
          {trend === 'down' && <ArrowDownRight className="w-3 h-3" />}
          {sub}
        </div>
      )}
    </div>
  );
}

const LIVE_SYMBOLS = [
  { key: 'BTCUSDT',  label: 'BTC' },
  { key: 'ETHUSDT',  label: 'ETH' },
  { key: 'SOLUSDT',  label: 'SOL' },
  { key: 'BNBUSDT',  label: 'BNB' },
  { key: 'AVAXUSDT', label: 'AVAX' },
  { key: 'XRPUSDT',  label: 'XRP' },
  { key: 'EURUSDT',  label: 'EUR/USD' },
  { key: 'PAXGUSDT', label: 'Gold' },
];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const prices    = useTradingStore(s => s.prices);
  const connected = useTradingStore(s => s.wsConnected);
  const signals   = useTradingStore(s => s.signals) as Signal[];
  const [expectedSymbol, setExpectedSymbol] = useState('BTC/USDT');
  const [expectedTimeframe, setExpectedTimeframe] = useState('1h');

  const { data: portfolios } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => (await api.get('/portfolios')).data,
  });

  const portfolio = portfolios?.[0];

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ['positions-summary', portfolio?.id],
    queryFn: async () => (await api.get(`/positions/summary?portfolioId=${portfolio!.id}`)).data,
    enabled: !!portfolio?.id,
  });

  const { data: fearGreed } = useQuery<{ value: number; classification: string }[]>({
    queryKey: ['fear-greed'],
    queryFn: async () => (await api.get('/market-data/fear-greed')).data,
    staleTime: 300_000,
  });

  const { data: fundingRates } = useQuery<{ symbol: string; fundingRate: number; fundingTime: string }[]>({
    queryKey: ['funding-rates'],
    queryFn: async () => (await api.get('/market-data/funding-rates')).data,
    staleTime: 300_000,
  });

  const { data: economicCalendar } = useQuery<{ date: string; time: string; currency: string; impact: string; title: string; forecast: string; previous: string }[]>({
    queryKey: ['economic-calendar'],
    queryFn: async () => (await api.get('/market-data/economic-calendar')).data,
    staleTime: 300_000,
  });

  const { data: onChainBtc } = useQuery<{ price: number; marketCap: number; transactions24h: number; mempoolSize: number; suggestedFee: number } | null>({
    queryKey: ['on-chain-btc'],
    queryFn: async () => (await api.get('/market-data/on-chain/btc')).data,
    staleTime: 300_000,
  });

  const { data: onChainEth } = useQuery<{ price: number; marketCap: number; transactions24h: number; gasPriceMedian: number } | null>({
    queryKey: ['on-chain-eth'],
    queryFn: async () => (await api.get('/market-data/on-chain/eth')).data,
    staleTime: 300_000,
  });

  const { data: basis } = useQuery<{ symbol: string; spotPrice: number; perpPrice: number; basis: number }[]>({
    queryKey: ['basis'],
    queryFn: async () => (await api.get('/market-data/basis')).data,
    staleTime: 300_000,
  });

  const { data: expectedMove, isLoading: expectedMoveLoading } = useQuery<ExpectedMoveResponse>({
    queryKey: ['expected-move', expectedSymbol, expectedTimeframe],
    queryFn: async () => (await api.get('/expected-move', { params: { symbol: expectedSymbol, timeframe: expectedTimeframe } })).data,
    staleTime: 60_000,
    enabled: Boolean(expectedSymbol),
  });

  const { data: predictorStatus, isLoading: predictorStatusLoading } = useQuery<{
    trained: boolean;
    accuracy?: number;
    samples?: number;
    featureCount?: number;
    updatedAt?: string;
  }>({
    queryKey: ['signal-predictor-status'],
    queryFn: async () => (await api.get('/signals/predictor/status')).data,
    staleTime: 120_000,
  });

  const { data: cotBtc } = useQuery<{ reportDate: string; asset: string; nonCommercialNet: number; openInterest: number } | null>({
    queryKey: ['cot', 'BTC'],
    queryFn: async () => (await api.get('/market-data/cot/BTC')).data,
    staleTime: 300_000,
  });

  const capital = portfolio ? parseFloat(portfolio.currentCapital) : 0;
  const initial = portfolio ? parseFloat(portfolio.initialCapital) : 0;
  const pnl     = summary?.totalPnl ?? (capital - initial);
  const pnlPct  = initial > 0 ? ((pnl / initial) * 100).toFixed(2) : '0.00';
  const winRate  = summary?.winRate ?? 0;
  const activeSignals = signals?.length ?? 0;
  const mlSignals = (signals ?? []).filter(s => typeof s.metadata?.ml_confidence === 'number');
  const mlCount = mlSignals.length;
  const avgManualConfidence = mlCount > 0
    ? mlSignals.reduce((sum, s) => sum + (s.confidence ?? 0), 0) / mlCount
    : null;
  const avgMlConfidence = mlCount > 0
    ? mlSignals.reduce((sum, s) => sum + ((s.metadata?.ml_confidence as number) ?? 0), 0) / mlCount
    : null;
  const mlBeatsManualPct = mlCount > 0
    ? mlSignals.filter(s => ((s.metadata?.ml_confidence as number) ?? 0) >= (s.confidence ?? 0)).length / mlCount * 100
    : null;

  const cotSnapshot = (cotBtc && typeof cotBtc.nonCommercialNet === 'number' && typeof cotBtc.openInterest === 'number') ? cotBtc : null;
  const onChainBtcSnapshot = (onChainBtc && typeof onChainBtc.price === 'number') ? onChainBtc : null;
  const onChainEthSnapshot = (onChainEth && typeof onChainEth.price === 'number') ? onChainEth : null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  const predictorAccuracy = predictorStatus?.accuracy != null ? (predictorStatus.accuracy * 100).toFixed(1) : null;
  const predictorSamples = predictorStatus?.samples ?? null;
  const predictorUpdated = predictorStatus?.updatedAt ? new Date(predictorStatus.updatedAt) : null;
  const predictorSubParts: string[] = [];
  if (predictorSamples != null) predictorSubParts.push(`${predictorSamples} échantillons`);
  if (predictorUpdated) predictorSubParts.push(`MAJ ${predictorUpdated.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  const predictorSub = predictorSubParts.length > 0 ? predictorSubParts.join(' · ') : predictorStatus?.trained ? 'Entraîné via Feature Store' : 'Jamais entraîné';

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">{greeting}, {user?.name?.split(' ')[0]} 👋</h2>
            <p className="text-gray-400 text-sm mt-0.5">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          <Link href="/signals" className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors">
            <Zap className="w-4 h-4" />Scanner les marchés
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {!portfolio
            ? [0,1,2,3].map(i => <SkeletonCard key={i} />)
            : <>
              <StatCard
                label="Capital disponible"
                value={`$${capital.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}`}
                sub={`${pnl >= 0 ? '+' : ''}${pnlPct}% vs capital initial`}
                trend={pnl >= 0 ? 'up' : 'down'}
                icon={<Briefcase className="w-4 h-4" />}
              />
              <StatCard
                label="P&L total"
                value={<span className={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>}
                sub={`${summary?.closed ?? 0} trade(s) clôturé(s)`}
                trend={pnl >= 0 ? 'up' : 'down'}
                icon={pnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              />
              <StatCard
                label="Positions ouvertes"
                value={String(summary?.open ?? 0)}
                sub={`Win rate : ${winRate > 0 ? winRate.toFixed(1) + '%' : '—'}`}
                trend="neutral"
                icon={<Activity className="w-4 h-4" />}
              />
              <StatCard
                label="Signaux actifs"
                value={String(activeSignals)}
                sub={activeSignals > 0 ? 'Voir les signaux →' : 'Lancer un scan'}
                trend={activeSignals > 0 ? 'up' : 'neutral'}
                icon={<Zap className="w-4 h-4" />}
              />
            </>
          }
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {predictorStatusLoading
            ? <SkeletonCard />
            : predictorStatus && (
              <StatCard
                label="SignalScorer (ML)"
                value={predictorStatus.trained && predictorAccuracy ? `${predictorAccuracy}% acc.` : 'Non entraîné'}
                sub={predictorSub}
                trend={predictorStatus?.trained ? 'up' : 'neutral'}
                icon={<Brain className="w-4 h-4" />}
              />
            )}
        </div>

        {/* Raccourcis rapides */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/signals',  label: 'Scanner',    desc: 'Lancer un scan',          icon: <Zap className="w-4 h-4" />,      color: 'text-emerald-400' },
            { href: '/backtest', label: 'Backtest',   desc: 'Tester une stratégie',    icon: <BarChart2 className="w-4 h-4" />, color: 'text-blue-400' },
            { href: '/brvm',     label: 'BRVM',       desc: 'Marché africain',          icon: <Globe className="w-4 h-4" />,    color: 'text-yellow-400' },
            { href: '/deriv',    label: 'Deriv V75',  desc: 'Scalp synthétiques',      icon: <Cpu className="w-4 h-4" />,      color: 'text-violet-400' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 flex items-center gap-3 transition-colors group">
              <span className={`${item.color} group-hover:scale-110 transition-transform`}>{item.icon}</span>
              <div>
                <p className="text-white text-sm font-medium">{item.label}</p>
                <p className="text-gray-500 text-xs">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Sentiment marché */}
        {fearGreed && fearGreed[0] && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Smile className={`w-8 h-8 ${
                fearGreed[0].value >= 75 ? 'text-red-400' :
                fearGreed[0].value >= 55 ? 'text-yellow-400' :
                fearGreed[0].value <= 25 ? 'text-emerald-400' :
                'text-blue-400'
              }`} />
              <div>
                <p className="text-xs text-gray-500">Fear & Greed</p>
                <p className="text-white font-semibold">{fearGreed[0].classification}</p>
                <p className="text-xs text-gray-500">{fearGreed[0].value}/100</p>
              </div>
            </div>
            <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${
                  fearGreed[0].value >= 75 ? 'bg-red-400' :
                  fearGreed[0].value >= 55 ? 'bg-yellow-400' :
                  fearGreed[0].value <= 25 ? 'bg-emerald-400' :
                  'bg-blue-400'
                }`}
                style={{ width: `${fearGreed[0].value}%` }}
              />
            </div>
          </div>
        )}

        <ExpectedMoveWidget
          data={expectedMove}
          isLoading={expectedMoveLoading}
          symbol={expectedSymbol}
          timeframe={expectedTimeframe}
          symbols={[
            { value: 'BTC/USDT', label: 'BTC/USDT' },
            { value: 'ETH/USDT', label: 'ETH/USDT' },
            { value: 'SOL/USDT', label: 'SOL/USDT' },
            { value: 'BNB/USDT', label: 'BNB/USDT' },
            { value: 'XAU/USD', label: 'XAU/USD' },
            { value: 'EUR/USD', label: 'EUR/USD' },
            { value: 'VIX', label: 'VIX' },
          ]}
          timeframes={[
            { value: '1h', label: '1H' },
            { value: '4h', label: '4H' },
            { value: '1d', label: '1D' },
          ]}
          onSymbolChange={setExpectedSymbol}
          onTimeframeChange={setExpectedTimeframe}
        />

        {/* Funding rates perp */}
        {fundingRates && fundingRates.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Banknote className="w-4 h-4 text-blue-400" />
              <p className="text-xs text-gray-500">Funding rates 8h</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {fundingRates.map(fr => {
                const ratePct = fr.fundingRate * 100;
                return (
                  <div key={fr.symbol} className="bg-gray-950/50 rounded p-2">
                    <p className="text-xs text-gray-400">{fr.symbol}</p>
                    <p className={`text-sm font-mono font-semibold ${ratePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {ratePct >= 0 ? '+' : ''}{ratePct.toFixed(4)}%
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Spot-perp basis */}
        {basis && basis.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Scale className="w-4 h-4 text-pink-400" />
              <p className="text-xs text-gray-500">Basis spot-perp</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {basis.map(b => (
                <div key={b.symbol} className="bg-gray-950/50 rounded p-2">
                  <p className="text-xs text-gray-400">{b.symbol}</p>
                  <p className={`text-sm font-mono font-semibold ${b.basis >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {b.basis >= 0 ? '+' : ''}{b.basis.toFixed(2)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* COT BTC */}
        {cotSnapshot && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-cyan-400" />
              <p className="text-xs text-gray-500">COT BTC CME ({cotSnapshot.reportDate})</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Net non-commercial</p>
                <p className={`text-sm font-mono font-semibold ${cotSnapshot.nonCommercialNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {cotSnapshot.nonCommercialNet >= 0 ? '+' : ''}{cotSnapshot.nonCommercialNet.toLocaleString('en-US')}
                </p>
              </div>
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Open interest</p>
                <p className="text-sm font-mono font-semibold text-white">{cotSnapshot.openInterest.toLocaleString('en-US')}</p>
              </div>
            </div>
          </div>
        )}

        {/* On-chain BTC */}
        {onChainBtcSnapshot && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-orange-400" />
              <p className="text-xs text-gray-500">On-chain BTC</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Prix</p>
                <p className="text-sm font-mono font-semibold text-white">${onChainBtcSnapshot.price.toLocaleString('en-US')}</p>
              </div>
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Tx 24h</p>
                <p className="text-sm font-mono font-semibold text-white">{onChainBtcSnapshot.transactions24h.toLocaleString('en-US')}</p>
              </div>
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Mempool</p>
                <p className="text-sm font-mono font-semibold text-white">{onChainBtcSnapshot.mempoolSize.toLocaleString('en-US')}</p>
              </div>
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Fee reco</p>
                <p className="text-sm font-mono font-semibold text-white">{onChainBtcSnapshot.suggestedFee} sat/vB</p>
              </div>
            </div>
          </div>
        )}

        {/* On-chain ETH */}
        {onChainEthSnapshot && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-indigo-400" />
              <p className="text-xs text-gray-500">On-chain ETH</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Prix</p>
                <p className="text-sm font-mono font-semibold text-white">${onChainEthSnapshot.price.toLocaleString('en-US')}</p>
              </div>
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Tx 24h</p>
                <p className="text-sm font-mono font-semibold text-white">{onChainEthSnapshot.transactions24h.toLocaleString('en-US')}</p>
              </div>
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Gas median</p>
                <p className="text-sm font-mono font-semibold text-white">{onChainEthSnapshot.gasPriceMedian} gwei</p>
              </div>
              <div className="bg-gray-950/50 rounded p-2">
                <p className="text-xs text-gray-400">Market cap</p>
                <p className="text-sm font-mono font-semibold text-white">${(onChainEthSnapshot.marketCap / 1e9).toFixed(0)}B</p>
              </div>
            </div>
          </div>
        )}

        {/* Calendrier économique */}
        {economicCalendar && economicCalendar.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-4 h-4 text-yellow-400" />
              <p className="text-xs text-gray-500">Calendrier économique (impact élevé/moyen)</p>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {economicCalendar.slice(0, 10).map((ev, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-gray-800 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${ev.impact === 'High' ? 'bg-red-400/10 text-red-400' : 'bg-yellow-400/10 text-yellow-400'}`}>{ev.currency}</span>
                    <span className="text-gray-300 truncate">{ev.title}</span>
                  </div>
                  <div className="text-xs text-gray-500 text-right shrink-0">
                    <p>{ev.time}</p>
                    <p className="text-gray-600">F:{ev.forecast} P:{ev.previous}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prix live */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {LIVE_SYMBOLS.map(({ key, label }) => {
            const price = prices[key];
            return (
              <div key={key} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className="text-base font-mono font-bold text-white">
                    {price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </p>
                </div>
                <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-700'}`} />
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Derniers signaux */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white">Derniers signaux</h3>
              </div>
              <Link href="/signals" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Voir tout →</Link>
            </div>
            {!signals || signals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-28 text-gray-600">
                <Activity className="w-7 h-7 mb-2" />
                <p className="text-sm">Aucun signal — lancez un scan</p>
              </div>
            ) : (
              <div className="space-y-2">
                {signals.slice(0, 4).map(s => {
                  const regime = s.metadata?.regime;
                  const fvg    = s.metadata?.smc?.fvg;
                  const ob     = s.metadata?.smc?.ob;
                  return (
                    <div key={s.id} className="py-2 border-b border-gray-800 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${s.signal === 'BUY' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>{s.signal}</span>
                          <span className="text-white text-sm font-medium">{s.asset?.symbol ?? '—'}</span>
                          <span className="text-gray-600 text-xs">{s.timeframe}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{Math.round(s.confidence)}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {regime?.regime && (
                          <span className={`text-[10px] px-1.5 py-0 rounded ${
                            regime.regime === 'TRENDING_BULL' ? 'bg-emerald-400/10 text-emerald-400' :
                            regime.regime === 'TRENDING_BEAR' ? 'bg-red-400/10 text-red-400' :
                            'bg-gray-700 text-gray-500'
                          }`}>{regime.regime.replace('_', ' ')}</span>
                        )}
                        {fvg?.near_bullish_fvg && <span className="text-[10px] px-1.5 py-0 rounded bg-cyan-400/10 text-cyan-400">FVG</span>}
                        {fvg?.near_bearish_fvg && <span className="text-[10px] px-1.5 py-0 rounded bg-rose-400/10 text-rose-400">FVG</span>}
                        {ob?.near_bullish_ob  && <span className="text-[10px] px-1.5 py-0 rounded bg-teal-400/10 text-teal-400">OB</span>}
                        {ob?.near_bearish_ob  && <span className="text-[10px] px-1.5 py-0 rounded bg-pink-400/10 text-pink-400">OB</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Portfolio recap */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white">{portfolio?.name ?? 'Portfolio'}</h3>
                <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">{portfolio?.type}</span>
              </div>
              <Link href="/portfolio" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Gérer →</Link>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Capital initial', value: `$${initial.toLocaleString()}` },
                { label: 'Capital actuel',  value: `$${capital.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}` },
                { label: 'P&L réalisé',     value: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, color: pnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: 'Win rate',         value: winRate > 0 ? `${winRate.toFixed(1)}%` : '—' },
                { label: 'Positions ouvertes', value: String(summary?.open ?? 0) },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">{row.label}</span>
                  <span className={`font-medium ${(row as any).color ?? 'text-white'}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <Link href="/journal" className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500 hover:text-gray-300 transition-colors">
              <BookOpen className="w-3.5 h-3.5" />Ouvrir le journal de trading
            </Link>
          </div>
        </div>
      </div>

      {mlCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Confiance moyenne (manuel)"
            value={avgManualConfidence ? `${avgManualConfidence.toFixed(1)}%` : '—'}
            sub={`Sur ${mlCount} signaux ML`}
            icon={<Brain className="w-4 h-4" />}
          />
          <StatCard
            label="Confiance moyenne ML"
            value={avgMlConfidence ? `${avgMlConfidence.toFixed(1)}%` : '—'}
            sub={mlBeatsManualPct != null ? `${mlBeatsManualPct.toFixed(0)}% ≥ manuel` : undefined}
            trend={avgMlConfidence && avgManualConfidence ? (avgMlConfidence >= avgManualConfidence ? 'up' : 'down') : 'neutral'}
            icon={<Cpu className="w-4 h-4" />}
          />
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-2">Écart ML vs manuel</p>
            <p className="text-2xl font-bold text-white">
              {avgMlConfidence && avgManualConfidence ? `${(avgMlConfidence - avgManualConfidence).toFixed(1)} pts` : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Positif = modèle ML plus confiant que le scoring manuel.</p>
          </div>
        </div>
      )}

    </AppLayout>
  );
}
