'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { FlaskConical, RefreshCw, TrendingUp, AlertTriangle, Activity, BarChart3, Dice5, GitBranch } from 'lucide-react';

type Tab = 'report' | 'monte-carlo' | 'walk-forward' | 'overfitting';

export default function ScientificBacktestPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('report');
  const [tradesInput, setTradesInput] = useState('');
  const [equityInput, setEquityInput] = useState('');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [mcSims, setMcSims] = useState(1000);
  const [wfTrain, setWfTrain] = useState(100);
  const [wfTest, setWfTest] = useState(50);
  const [wfStep, setWfStep] = useState(25);
  const [inSample, setInSample] = useState('{\n  "win_rate": 65,\n  "profit_factor": 2.5,\n  "sharpe": 1.8,\n  "pnl": 5000\n}');
  const [outSample, setOutSample] = useState('{\n  "win_rate": 52,\n  "profit_factor": 1.3,\n  "sharpe": 0.9,\n  "pnl": 1800\n}');

  const mutation = useMutation({
    mutationFn: async () => {
      const trades = tradesInput ? JSON.parse(tradesInput) : [];
      const equity = equityInput ? JSON.parse(equityInput) : [];

      if (tab === 'report') {
        const res = await api.post('/ai/backtest/scientific-report', {
          trades, equity, initial_capital: initialCapital, risk_pct: riskPct,
          mc_simulations: mcSims, wf_train_window: wfTrain, wf_test_window: wfTest, wf_step: wfStep,
        });
        return res.data;
      }
      if (tab === 'monte-carlo') {
        const res = await api.post('/ai/backtest/monte-carlo', {
          trades, equity, initial_capital: initialCapital, risk_pct: riskPct, mc_simulations: mcSims,
        });
        return res.data;
      }
      if (tab === 'walk-forward') {
        const res = await api.post('/ai/backtest/walk-forward', {
          trades, equity, wf_train_window: wfTrain, wf_test_window: wfTest, wf_step: wfStep,
        });
        return res.data;
      }
      if (tab === 'overfitting') {
        const res = await api.post('/ai/backtest/overfitting-check', {
          in_sample: JSON.parse(inSample), out_sample: JSON.parse(outSample),
        });
        return res.data;
      }
    },
  });

  const tabConfig: Record<Tab, { icon: React.ReactNode; label: string }> = {
    report: { icon: <FlaskConical className="w-4 h-4" />, label: 'Full Report' },
    'monte-carlo': { icon: <Dice5 className="w-4 h-4" />, label: 'Monte Carlo' },
    'walk-forward': { icon: <GitBranch className="w-4 h-4" />, label: 'Walk-Forward' },
    overfitting: { icon: <AlertTriangle className="w-4 h-4" />, label: 'Overfitting' },
  };

  const data = mutation.data;
  const verdictColor: Record<string, string> = {
    ROBUST: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    MILD_OVERFITTING: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    MODERATE_OVERFITTING: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    SEVERE_OVERFITTING: 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  return (
    <AppLayout title="Scientific Backtest">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-6 h-6 text-cyan-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Scientific Backtest</h1>
            <p className="text-sm text-gray-400">Sortino, Calmar, Monte Carlo, Walk-Forward, Overfitting Detection</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(Object.keys(tabConfig) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition ${
                tab === t ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tabConfig[t].icon} {tabConfig[t].label}
            </button>
          ))}
        </div>

        {/* Input forms */}
        {tab !== 'overfitting' ? (
          <div className="space-y-4 p-4 bg-gray-900 border border-gray-800 rounded-xl">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Trades JSON (array of {`{pnl, pnl_pct, win, rr_achieved}`})</label>
              <textarea
                value={tradesInput}
                onChange={(e) => setTradesInput(e.target.value)}
                placeholder='[{"pnl": 200, "pnl_pct": 2.0, "win": true, "rr_achieved": 2}, {"pnl": -100, "pnl_pct": -1.0, "win": false, "rr_achieved": 1}]'
                className="w-full h-32 px-3 py-2 text-xs font-mono bg-gray-800 border border-gray-700 rounded text-white overflow-auto"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Equity Curve JSON (array of floats)</label>
              <textarea
                value={equityInput}
                onChange={(e) => setEquityInput(e.target.value)}
                placeholder='[10000, 10200, 10100, 10400, ...]'
                className="w-full h-20 px-3 py-2 text-xs font-mono bg-gray-800 border border-gray-700 rounded text-white"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-gray-400">Initial Capital</label>
                <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Risk %</label>
                <input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-400">MC Simulations</label>
                <input type="number" value={mcSims} onChange={(e) => setMcSims(Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-400">WF Train Window</label>
                <input type="number" value={wfTrain} onChange={(e) => setWfTrain(Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-400">WF Test Window</label>
                <input type="number" value={wfTest} onChange={(e) => setWfTest(Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 p-4 bg-gray-900 border border-gray-800 rounded-xl">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">In-Sample Metrics JSON</label>
              <textarea
                value={inSample}
                onChange={(e) => setInSample(e.target.value)}
                className="w-full h-40 px-3 py-2 text-xs font-mono bg-gray-800 border border-gray-700 rounded text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Out-Sample Metrics JSON</label>
              <textarea
                value={outSample}
                onChange={(e) => setOutSample(e.target.value)}
                className="w-full h-40 px-3 py-2 text-xs font-mono bg-gray-800 border border-gray-700 rounded text-white"
              />
            </div>
          </div>
        )}

        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg transition"
        >
          {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          Run Analysis
        </button>

        {mutation.isError && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            Error: {(mutation.error as any)?.message || 'Analysis failed'}
          </div>
        )}

        {/* Results */}
        {data && (
          <div className="space-y-4">
            {/* Full Report */}
            {tab === 'report' && (
              <>
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Advanced Metrics
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <MetricCard label="Sortino Ratio" value={(data as any).advanced_metrics?.sortino_ratio} good={'> 1'} />
                    <MetricCard label="Calmar Ratio" value={(data as any).advanced_metrics?.calmar_ratio} good={'> 1'} />
                    <MetricCard label="Max Consec. Losses" value={(data as any).advanced_metrics?.max_consecutive_losses} good={'< 5'} />
                    <MetricCard label="Risk of Ruin" value={`${(data as any).advanced_metrics?.risk_of_ruin_pct}%`} good={'< 1%'} />
                  </div>
                </div>

                {(data as any).monte_carlo && !((data as any).monte_carlo?.error) && (
                  <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                    <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                      <Dice5 className="w-4 h-4" /> Monte Carlo ({(data as any).monte_carlo.simulations} simulations)
                    </h3>
                    <MonteCarloResults data={(data as any).monte_carlo} />
                  </div>
                )}

                {(data as any).walk_forward && !((data as any).walk_forward?.error) && (
                  <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                    <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                      <GitBranch className="w-4 h-4" /> Walk-Forward Validation
                    </h3>
                    <WalkForwardResults data={(data as any).walk_forward} verdictColor={verdictColor} />
                  </div>
                )}

                <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-400">
                  {(data as any).summary}
                </div>
              </>
            )}

            {/* Monte Carlo only */}
            {tab === 'monte-carlo' && !(data as any).error && (
              <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                <MonteCarloResults data={data as any} />
              </div>
            )}

            {/* Walk-Forward only */}
            {tab === 'walk-forward' && !(data as any).error && (
              <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                <WalkForwardResults data={data as any} verdictColor={verdictColor} />
              </div>
            )}

            {/* Overfitting */}
            {tab === 'overfitting' && (
              <div className="space-y-4">
                <div className={`p-4 rounded-xl border-2 ${verdictColor[(data as any).verdict] || verdictColor.ROBUST}`}>
                  <p className="text-2xl font-bold">{(data as any).verdict}</p>
                  <p className="text-sm opacity-80 mt-1">{(data as any).summary}</p>
                </div>
                <div className="space-y-2">
                  {(data as any).checks?.map((check: any, i: number) => (
                    <div key={i} className={`p-3 rounded-lg border ${
                      check.severity === 'high' ? 'border-red-500/20 bg-red-500/5' :
                      check.severity === 'medium' ? 'border-yellow-500/20 bg-yellow-500/5' :
                      'border-gray-700 bg-gray-800/50'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white capitalize">{check.metric.replace(/_/g, ' ')}</span>
                        <span className={`text-xs uppercase ${check.overfit ? 'text-red-400' : 'text-emerald-400'}`}>
                          {check.overfit ? 'OVERFIT' : 'OK'}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>In: {check.in_sample}</span>
                        <span>Out: {check.out_sample}</span>
                        {check.degradation_pct !== undefined && (
                          <span className={check.degradation_pct > 30 ? 'text-red-400' : 'text-gray-400'}>
                            Drop: {check.degradation_pct}%
                          </span>
                        )}
                        {check.degradation !== undefined && (
                          <span className={check.degradation > 10 ? 'text-red-400' : 'text-gray-400'}>
                            Drop: {check.degradation}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function MetricCard({ label, value, good }: { label: string; value: any; good: string }) {
  return (
    <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-white mt-1">{value ?? '—'}</p>
      <p className="text-[10px] text-gray-600 mt-0.5">Good: {good}</p>
    </div>
  );
}

function MonteCarloResults({ data }: { data: any }) {
  const fc = data.final_capital;
  const dd = data.max_drawdown;
  const wr = data.win_rate;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetricCard label="Prob. of Profit" value={`${fc?.probability_of_profit}%`} good={'> 80%'} />
        <MetricCard label="Prob. of 2x" value={`${fc?.probability_of_2x}%`} good={'> 20%'} />
        <MetricCard label="Prob. of Loss" value={`${fc?.probability_of_loss}%`} good={'< 10%'} />
        <MetricCard label="Prob. of 50% Loss" value={`${fc?.probability_of_50pct_loss}%`} good={'< 1%'} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs text-gray-500 mb-2">Final Capital Distribution</h4>
          <div className="space-y-1">
            {fc?.percentiles && Object.entries(fc.percentiles).map(([p, v]: [string, any]) => (
              <div key={p} className="flex justify-between text-xs">
                <span className="text-gray-500">P{p}</span>
                <span className="font-mono text-gray-300">${v.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs text-gray-500 mb-2">Max Drawdown Distribution</h4>
          <div className="space-y-1">
            {dd?.percentiles && Object.entries(dd.percentiles).map(([p, v]: [string, any]) => (
              <div key={p} className="flex justify-between text-xs">
                <span className="text-gray-500">P{p}</span>
                <span className="font-mono text-gray-300">{v}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function WalkForwardResults({ data, verdictColor }: { data: any; verdictColor: Record<string, string> }) {
  return (
    <>
      <div className={`p-3 rounded-lg border-2 mb-4 ${verdictColor[data.overfit_verdict] || verdictColor.ROBUST}`}>
        <p className="text-lg font-bold">{data.overfit_verdict}</p>
        <p className="text-xs opacity-80 mt-1">{data.summary}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2">Window</th>
              <th className="text-right">Train PnL</th>
              <th className="text-right">Test PnL</th>
              <th className="text-right">Train WR</th>
              <th className="text-right">Test WR</th>
              <th className="text-right">Degradation</th>
              <th className="text-center">Overfit</th>
            </tr>
          </thead>
          <tbody>
            {data.windows?.map((w: any, i: number) => (
              <tr key={i} className="border-b border-gray-800/50">
                <td className="py-2 text-gray-400">#{i + 1}</td>
                <td className="text-right font-mono text-gray-300">${w.train_pnl}</td>
                <td className="text-right font-mono text-gray-300">${w.test_pnl}</td>
                <td className="text-right text-gray-400">{w.train_win_rate}%</td>
                <td className="text-right text-gray-400">{w.test_win_rate}%</td>
                <td className={`text-right font-mono ${w.pnl_degradation_pct > 50 ? 'text-red-400' : w.pnl_degradation_pct > 30 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  {w.pnl_degradation_pct}%
                </td>
                <td className="text-center">{w.overfit_flag ? '⚠️' : '✓'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
