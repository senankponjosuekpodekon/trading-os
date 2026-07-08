'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { AppLayout } from '@/components/layout/AppLayout';
import { Play, TrendingUp, TrendingDown, BarChart2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8000';

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
}

const SYMBOLS   = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];
const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniEquityChart({ curve }: { curve: number[] }) {
  if (curve.length < 2) return null;
  const min  = Math.min(...curve);
  const max  = Math.max(...curve);
  const range = max - min || 1;
  const w = 400, h = 100;
  const pts = curve.map((v, i) => {
    const x = (i / (curve.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 10) - 5;
    return `${x},${y}`;
  }).join(' ');
  const isPositive = curve[curve.length - 1] >= curve[0];
  const color = isPositive ? '#34d399' : '#f87171';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">Courbe d'équité</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${h} ${pts} ${w},${h}`}
          fill="url(#eqGrad)"
        />
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
      </svg>
      <div className="flex justify-between text-xs text-gray-600 mt-1">
        <span>${min.toFixed(0)}</span>
        <span>${max.toFixed(0)}</span>
      </div>
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
  const [showTrades,  setShowTrades]  = useState(false);

  const { mutate, data: result, isPending, error } = useMutation<BacktestResult>({
    mutationFn: async () => {
      const res = await axios.post(`${ENGINE_URL}/backtest/run`, {
        symbol,
        timeframe,
        lookback_bars:   lookback,
        initial_capital: capital,
        risk_pct:        riskPct,
        min_confidence:  minConf,
      });
      return res.data;
    },
  });

  const pnlPos = (result?.total_pnl ?? 0) >= 0;

  return (
    <AppLayout title="Backtest">
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
              <label className="text-xs text-gray-400 mb-1 block">Symbole</label>
              <select value={symbol} onChange={e => setSymbol(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                {SYMBOLS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Timeframe</label>
              <select value={timeframe} onChange={e => setTimeframe(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Bougies</label>
              <input type="number" value={lookback} min={100} max={1000} step={50}
                onChange={e => setLookback(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Capital ($)</label>
              <input type="number" value={capital} min={1000} step={1000}
                onChange={e => setCapital(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Risque %</label>
              <input type="number" value={riskPct} min={0.1} max={5} step={0.1}
                onChange={e => setRiskPct(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Conf. min %</label>
              <input type="number" value={minConf} min={40} max={90} step={5}
                onChange={e => setMinConf(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
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
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            Erreur backtest — vérifier que l'engine est actif
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

            {/* Equity curve */}
            <MiniEquityChart curve={result.equity_curve} />

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
                  <div className="overflow-x-auto">
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
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
