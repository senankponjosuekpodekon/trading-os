'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { Play, TrendingUp, TrendingDown, BarChart2, AlertCircle, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

const MiniEquityChart = dynamic(
  () => import('@/components/backtest/MiniEquityChart').then(mod => mod.MiniEquityChart),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const MonteCarloChart = dynamic(
  () => import('@/components/backtest/MonteCarloChart').then(mod => mod.MonteCarloChart),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const CalibrationCurve = dynamic(
  () => import('@/components/backtest/CalibrationCurve').then(mod => mod.CalibrationCurve),
  { ssr: false, loading: () => <div className="h-28 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const WalkForwardResults = dynamic(
  () => import('@/components/backtest/WalkForwardResults').then(mod => mod.WalkForwardResults),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const RegimeBreakdown = dynamic(
  () => import('@/components/backtest/RegimeBreakdown').then(mod => mod.RegimeBreakdown),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const AssetBreakdown = dynamic(
  () => import('@/components/backtest/AssetBreakdown').then(mod => mod.AssetBreakdown),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const ChampionModelBadge = dynamic(
  () => import('@/components/backtest/ChampionModelBadge').then(mod => mod.ChampionModelBadge),
  { ssr: false, loading: () => <div className="h-16 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const PatternBreakdown = dynamic(
  () => import('@/components/backtest/PatternBreakdown').then(mod => mod.PatternBreakdown),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);
const BacktestChart = dynamic(
  () => import('@/components/backtest/BacktestChart').then(mod => mod.BacktestChart),
  { ssr: false, loading: () => <div className="h-96 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);

interface TradeItem {
  entry_bar:      number;
  exit_bar:       number;
  direction:      string;
  entry_price:    number;
  exit_price:     number;
  pnl:            number;
  pnl_pct:        number;
  rr_achieved:    number;
  confidence:     number;
  signal_reasons: string[];
  win:            boolean;
  exit_reason:    string;
  regime?:        string;
  duration_bars?: number;
  pattern_name?:  string;
  pattern_direction?: string;
  pattern_confluence_score?: number;
  pattern_confluence_tags?: string[];
}

interface RegimeBreakdown {
  [regime: string]: { trades: number; wins: number; pnl: number; win_rate: number };
}

interface PatternBreakdown {
  [pattern: string]: {
    trades: number; wins: number; losses: number; pnl: number; win_rate: number;
    avg_pnl_pct: number; avg_rr: number; avg_duration_bars: number; avg_confluence_score: number;
  };
}

interface BacktestResult {
  symbol:           string;
  timeframe:        string;
  bars_analyzed:    number;
  trades:           number;
  wins:             number;
  losses:           number;
  win_rate:         number;
  total_pnl:        number;
  total_pnl_pct:    number;
  max_drawdown:     number;
  max_drawdown_pct: number;
  sharpe_ratio:     number;
  avg_rr:           number;
  profit_factor:    number;
  final_capital:    number;
  equity_curve:     number[];
  trade_list:       TradeItem[];
  klines:           { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  signals:          { type: 'entry' | 'exit'; bar_index: number; time: string; direction: string; price: number; sl?: number; tp1?: number; confidence?: number; pattern?: string; exit_reason?: string; intrabar_ambiguous?: boolean }[];
  bar_times:        string[];
  regime_breakdown: RegimeBreakdown;
  pattern_breakdown: PatternBreakdown;
  model_version:    string;
  benchmark_pnl_pct: number;
  outperformance_pct: number;
}

interface Strategy {
  id: string;
  name: string;
  rules?: Record<string, any>;
  isActive?: boolean;
}

const SYMBOLS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT',
  'AVAX/USDT', 'DOT/USDT', 'LINK/USDT', 'LTC/USDT', 'TRX/USDT', 'TON/USDT',
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
  'AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'NFLX', 'AMD', 'INTC',
  'XAU/USD', 'XAG/USD', 'WTI/USD', 'BRENT/USD',
  'V75', 'V100', 'BOOM500', 'CRASH500',
];
const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

function detectMarket(sym: string): string {
  const s = sym.toUpperCase();
  if (/^(V\d+|BOOM\d+|CRASH\d+)/i.test(s)) return 'synthetic';
  if (['XAU', 'XAG', 'WTI', 'BRENT'].some(x => s.includes(x))) return 'commodities';
  if (s.includes('/')) {
    const [base, quote] = s.split('/');
    const q = quote?.toUpperCase() ?? '';
    const cryptoQuotes = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH', 'BNB', 'SOL'];
    const fiat = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'];
    if (cryptoQuotes.includes(q)) return 'crypto';
    if (fiat.includes(base.toUpperCase()) || fiat.includes(q)) return 'forex';
  }
  if (/^[A-Z]{1,5}$/.test(s)) return 'stocks';
  return 'crypto';
}

function InfoLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="group relative inline-flex items-center gap-1 text-xs text-gray-400 mb-1 block">
      {label}
      <HelpCircle className="w-3 h-3 text-gray-600 group-hover:text-emerald-400" />
      <span className="absolute bottom-full left-0 mb-1 hidden w-56 group-hover:block z-20 rounded-lg bg-gray-800 border border-gray-700 p-2 text-[10px] text-white shadow-lg">
        {tip}
      </span>
    </span>
  );
}

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function BacktestPage() {
  const [symbol,      setSymbol]      = useState('ETH/USDT');
  const [timeframe,   setTimeframe]   = useState('1h');
  const [lookback,    setLookback]    = useState(300);
  const [capital,     setCapital]     = useState(10000);
  const [riskPct,     setRiskPct]     = useState(1.0);
  const [minConf,     setMinConf]     = useState(55);
  const [useSmc,      setUseSmc]      = useState(false);
  const [usePatterns, setUsePatterns] = useState(false);
  const [strategyId,  setStrategyId]   = useState<string>('');
  const [market,      setMarket]      = useState('crypto');
  const [showTrades,  setShowTrades]  = useState(false);

  useEffect(() => {
    setMarket(detectMarket(symbol));
  }, [symbol]);

  const { data: strategies } = useQuery<Strategy[]>({
    queryKey: ['strategies'],
    queryFn: async () => (await api.get('/strategies')).data,
  });

  const { mutate, data: result, isPending, error } = useMutation<BacktestResult>({
    mutationFn: async () => {
      const payload: any = {
        symbol,
        timeframe,
        lookback_bars:   lookback,
        initial_capital: capital,
        risk_pct:        riskPct,
        min_confidence:  minConf,
      };
      if (strategyId) {
        payload.strategyId = strategyId;
      } else {
        payload.strategy = {
          rules: {
            use_smc: useSmc,
            use_patterns: usePatterns,
          },
        };
      }
      const res = await api.post('/backtest/run', payload);
      return res.data;
    },
  });

  const { mutate: mutateMarket, data: marketResult, isPending: marketPending, error: marketError } = useMutation<BacktestResult[]>({
    mutationFn: async () => {
      const payload: any = {
        timeframe,
        lookback_bars:   lookback,
        initial_capital: capital,
        risk_pct:        riskPct,
        min_confidence:  minConf,
      };
      if (strategyId) {
        payload.strategyId = strategyId;
      } else {
        payload.strategy = {
          rules: {
            use_smc: useSmc,
            use_patterns: usePatterns,
          },
        };
      }
      const res = await api.post(`/backtest/market/${market}`, payload);
      return res.data;
    },
  });

  const pnlPos = (result?.total_pnl ?? 0) >= 0;

  const assetBreakdown = useMemo(() => {
    if (!result) return {};
    return result.trade_list.reduce((acc, t) => {
      const asset = result.symbol;
      if (!acc[asset]) acc[asset] = { trades: 0, wins: 0, pnl: 0, win_rate: 0 };
      acc[asset].trades += 1;
      if (t.win) acc[asset].wins += 1;
      acc[asset].pnl += t.pnl;
      acc[asset].win_rate = acc[asset].trades > 0 ? (acc[asset].wins / acc[asset].trades) * 100 : 0;
      return acc;
    }, {} as { [asset: string]: { trades: number; wins: number; pnl: number; win_rate: number } });
  }, [result]);

  return (
    <>
      <div className="space-y-6">

        {/* En-tête */}
        <div>
          <h2 className="text-xl font-semibold text-white">Backtesting Engine</h2>
          <p className="text-gray-500 text-sm mt-0.5">Rejoue la stratégie SMC complète sur données historiques Binance</p>
        </div>

        {/* Formulaire */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <InfoLabel label="Stratégie" tip="Stratégie enregistrée. Si vide, les toggles SMC / Patterns manuels sont utilisés." />
              <select value={strategyId} onChange={e => setStrategyId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                <option value="">Manuelle (SMC/Patterns)</option>
                {strategies?.filter(s => s.isActive).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <InfoLabel label="Symbole" tip="Paire ou actif à tester. Supporte crypto, forex, stocks, commodities et synthetic." />
              <input
                list="backtest-symbols"
                type="text"
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
              <datalist id="backtest-symbols">
                {SYMBOLS.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <InfoLabel label="Timeframe" tip="Intervalle temporel des bougies historiques utilisées pour générer les signaux." />
              <select value={timeframe} onChange={e => setTimeframe(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <InfoLabel label="Bougies" tip="Nombre de bougies historiques à charger. Minimum 100, maximum 1000." />
              <input type="number" value={lookback} min={100} max={1000} step={50}
                onChange={e => setLookback(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <InfoLabel label="Capital ($)" tip="Capital initial simulé. Il sert de base à la courbe d'équité et au sizing." />
              <input type="number" value={capital} min={1000} step={1000}
                onChange={e => setCapital(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <InfoLabel label="Risque %" tip="Pourcentage du capital mis en danger sur chaque trade. Détermine la taille de position." />
              <input type="number" value={riskPct} min={0.1} max={5} step={0.1}
                onChange={e => setRiskPct(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <InfoLabel label="Conf. min %" tip="Seuil de confiance minimum requis pour qu'un signal génère une entrée." />
              <input type="number" value={minConf} min={40} max={90} step={5}
                onChange={e => setMinConf(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
              <input id="use-smc" type="checkbox" checked={useSmc} onChange={e => setUseSmc(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
              <label htmlFor="use-smc" className="cursor-pointer"><InfoLabel label="SMC" tip="Active la détection SMC (Order Blocks, FVG, liquidité) dans la stratégie manuelle." /></label>
            </div>
            <div className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
              <input id="use-patterns" type="checkbox" checked={usePatterns} onChange={e => setUsePatterns(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
              <label htmlFor="use-patterns" className="cursor-pointer"><InfoLabel label="Patterns" tip="Active la détection des patterns de prix (triangle, double top, etc.)." /></label>
            </div>
            <div className="flex items-center gap-2 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
              <InfoLabel label="Marché" tip="Marché utilisé pour le backtest batch sur plusieurs symboles." />
              <select value={market} onChange={e => setMarket(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-500">
                <option value="crypto">Crypto</option>
                <option value="forex">Forex</option>
                <option value="stocks">Stocks</option>
                <option value="commodities">Commodities</option>
                <option value="synthetic">Synthetic</option>
              </select>
            </div>
            <div className="flex items-center justify-end">
              <button onClick={() => mutateMarket()} disabled={marketPending || isPending}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors">
                {marketPending
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Batch…</>
                  : <><BarChart2 className="w-4 h-4" />Batch marché</>
                }
              </button>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button onClick={() => mutate()} disabled={isPending}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors">
              {isPending
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Calcul en cours…</>
                : <><Play className="w-4 h-4" />Lancer le backtest</>
              }
            </button>
          </div>
        </div>

        {/* Erreur */}
        {(error || marketError) && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            Erreur backtest — vérifier que l&apos;engine est actif
          </div>
        )}

        {/* Résultats */}
        {result && (
          <div className="space-y-4">

            {/* Titre résumé */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BarChart2 className="w-5 h-5 text-emerald-400" />
                <h3 className="font-semibold text-white">{result.symbol} · {result.timeframe} · {result.bars_analyzed} bougies</h3>
              </div>
              <span className={`text-sm font-mono font-bold px-3 py-1 rounded-lg ${pnlPos ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>
                {pnlPos ? '+' : ''}{result.total_pnl_pct}%
              </span>
            </div>

            {/* Métriques */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
              <MetricCard label="Trades" value={String(result.trades)} sub={`W:${result.wins}  L:${result.losses}`} />
              <MetricCard label="Win Rate" value={`${result.win_rate}%`}
                color={result.win_rate >= 50 ? 'text-emerald-400' : 'text-red-400'} />
              <MetricCard label="PnL total" value={`${pnlPos ? '+' : ''}$${result.total_pnl}`}
                sub={`${pnlPos ? '+' : ''}${result.total_pnl_pct}%`}
                color={pnlPos ? 'text-emerald-400' : 'text-red-400'} />
              <MetricCard label="Capital final" value={`$${result.final_capital.toLocaleString()}`} />
              <MetricCard label="Max Drawdown" value={`$${result.max_drawdown}`}
                sub={`${result.max_drawdown_pct}%`} color="text-orange-400" />
              <MetricCard label="Sharpe Ratio" value={String(result.sharpe_ratio)}
                color={result.sharpe_ratio >= 1 ? 'text-emerald-400' : 'text-gray-400'} />
              <MetricCard label="Avg R/R" value={`${result.avg_rr}x`}
                color={result.avg_rr >= 1.5 ? 'text-emerald-400' : 'text-gray-400'} />
              <MetricCard label="Profit Factor" value={String(result.profit_factor)}
                color={result.profit_factor >= 1.5 ? 'text-emerald-400' : result.profit_factor < 1 ? 'text-red-400' : 'text-gray-400'} />
            </div>

            {/* Chart setups */}
            <BacktestChart klines={result.klines || []} signals={result.signals || []} />

            {/* Equity curve */}
            <MiniEquityChart curve={result.equity_curve} />

            {/* Champion model & benchmark */}
            <ChampionModelBadge
              modelVersion={result.model_version ?? 'engine-1.0.0'}
              winRate={result.win_rate}
              profitFactor={result.profit_factor}
              sharpe={result.sharpe_ratio}
            />

            {/* Monte-Carlo & Walk-forward & Calibration */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MonteCarloChart tradePnls={result.trade_list.map(t => t.pnl)} initialCapital={capital} />
              <CalibrationCurve trades={result.trade_list.map(t => ({ confidence: t.confidence, win: t.win }))} />
            </div>
            <WalkForwardResults trades={result.trade_list} />

            {/* Regime, Asset & Pattern breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <RegimeBreakdown breakdown={result.regime_breakdown ?? {}} />
              <AssetBreakdown breakdown={assetBreakdown} />
              <PatternBreakdown breakdown={result.pattern_breakdown ?? {}} />
            </div>

            {/* Liste des trades */}
            {result.trade_list.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowTrades(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-white hover:bg-gray-800/50 transition-colors">
                  <span>Détail des trades ({result.trade_list.length})</span>
                  {showTrades ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showTrades && (
                  <div>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-t border-gray-800 bg-gray-800/50">
                            {['#', 'Dir', 'Entry', 'Exit', 'PnL $', 'PnL %', 'R/R', 'Conf', 'Raison sortie'].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-gray-500 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {result.trade_list.map((t, i) => (
                            <tr key={i} className={`hover:bg-gray-800/30 ${t.win ? '' : 'opacity-75'}`}>
                              <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                              <td className="px-4 py-2">
                                <span className={`px-1.5 py-0.5 rounded font-bold ${t.direction === 'BUY' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                                  {t.direction}
                                </span>
                              </td>
                              <td className="px-4 py-2 font-mono text-gray-300">${t.entry_price.toLocaleString()}</td>
                              <td className="px-4 py-2 font-mono text-gray-300">${t.exit_price.toLocaleString()}</td>
                              <td className={`px-4 py-2 font-mono font-semibold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {t.pnl >= 0 ? '+' : ''}${t.pnl}
                              </td>
                              <td className={`px-4 py-2 font-mono ${t.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%
                              </td>
                              <td className="px-4 py-2 font-mono text-gray-400">{t.rr_achieved}x</td>
                              <td className="px-4 py-2 text-gray-400">{Math.round(t.confidence)}%</td>
                              <td className="px-4 py-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  t.exit_reason === 'TP'      ? 'bg-emerald-400/10 text-emerald-400' :
                                  t.exit_reason === 'SL'      ? 'bg-red-400/10 text-red-400' :
                                  'bg-gray-700 text-gray-400'
                                }`}>{t.exit_reason}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden p-4 space-y-3">
                      {result.trade_list.map((t, i) => (
                        <div key={i} className={`bg-gray-800/50 border rounded-xl p-4 space-y-2 ${t.win ? 'border-emerald-500/20' : 'border-red-500/20'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">#{i + 1}</span>
                              <span className={`px-1.5 py-0.5 rounded font-bold text-xs ${t.direction === 'BUY' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                                {t.direction}
                              </span>
                            </div>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              t.exit_reason === 'TP' ? 'bg-emerald-400/10 text-emerald-400' :
                              t.exit_reason === 'SL' ? 'bg-red-400/10 text-red-400' :
                              'bg-gray-700 text-gray-400'
                            }`}>{t.exit_reason}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <p className="text-gray-500">Entry</p>
                              <p className="font-mono text-gray-300">${t.entry_price.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Exit</p>
                              <p className="font-mono text-gray-300">${t.exit_price.toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">R/R</p>
                              <p className="font-mono text-gray-400">{t.rr_achieved}x</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Conf</p>
                              <p className="font-mono text-gray-400">{Math.round(t.confidence)}%</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                            <span className={`font-mono font-semibold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {t.pnl >= 0 ? '+' : ''}${t.pnl}
                            </span>
                            <span className={`font-mono text-xs ${t.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Batch market results */}
        {marketResult && (
          <div className="space-y-4">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-400" /> Résultats batch {market}
            </h3>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/50">
                  <tr>
                    {['Symbole','Trades','Win %','PnL %','PF'].map(h => <th key={h} className="px-4 py-2 text-left text-gray-400 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {marketResult.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-800/30">
                      <td className="px-4 py-2 text-white">{r.symbol}</td>
                      <td className="px-4 py-2 text-gray-300">{r.trades}</td>
                      <td className="px-4 py-2 text-gray-300">{r.win_rate}%</td>
                      <td className={`px-4 py-2 font-mono ${(r.total_pnl_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{(r.total_pnl_pct ?? 0) >= 0 ? '+' : ''}{r.total_pnl_pct}%</td>
                      <td className="px-4 py-2 font-mono text-gray-300">{r.profit_factor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
