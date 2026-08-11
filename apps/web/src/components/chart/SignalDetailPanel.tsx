'use client';
import { Signal } from '@/types';
import { TrendingUp, TrendingDown, Minus, X, Target, Shield, Activity, Layers, Brain, AlertTriangle, Gauge } from 'lucide-react';

interface SignalDetailPanelProps {
  signal: Signal | null;
  onClose: () => void;
}

export function SignalDetailPanel({ signal, onClose }: SignalDetailPanelProps) {
  if (!signal) return null;

  const isBuy = signal.signal === 'BUY';
  const isSell = signal.signal === 'SELL';
  const accent = isBuy ? 'emerald' : isSell ? 'red' : 'gray';
  const Icon = isBuy ? TrendingUp : isSell ? TrendingDown : Minus;

  const entry = signal.entryPrice ? parseFloat(signal.entryPrice) : null;
  const sl = signal.stopLoss ? parseFloat(signal.stopLoss) : null;
  const tp1 = signal.takeProfit1 ? parseFloat(signal.takeProfit1) : null;
  const tp2 = signal.takeProfit2 ? parseFloat(signal.takeProfit2) : null;
  const tp3 = signal.takeProfit3 ? parseFloat(signal.takeProfit3) : null;

  const rr = signal.riskReward ?? (entry && sl && tp1 ? Math.abs(tp1 - entry) / Math.abs(entry - sl) : null);
  const md = signal.metadata;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-gray-900 border-l border-gray-800 overflow-y-auto z-20 shadow-xl">
      <div className="sticky top-0 bg-gray-900 border-b border-gray-800 p-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 text-${accent}-400`} />
          <span className={`text-sm font-bold text-${accent}-400`}>{signal.signal}</span>
          <span className="text-xs text-gray-500">{signal.timeframe}</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-4">
        {/* Confidence & status */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-gray-500">Confiance</p>
            <p className={`text-2xl font-bold text-${accent}-400`}>{Math.round(signal.confidence)}%</p>
          </div>
          {signal.status && (
            <div>
              <p className="text-xs text-gray-500">Statut</p>
              <span className={`text-xs px-2 py-0.5 rounded ${
                signal.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' :
                signal.status === 'INVALIDATED' ? 'bg-red-500/10 text-red-400' :
                'bg-gray-700 text-gray-400'
              }`}>{signal.status}</span>
            </div>
          )}
        </div>

        {/* Strategy */}
        {signal.strategy?.name && (
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Strategie</p>
            <p className="text-sm text-gray-300">{signal.strategy.name}</p>
          </div>
        )}

        {/* Price levels */}
        {(entry || sl || tp1) && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-500 flex items-center gap-1"><Target className="w-3 h-3" /> Niveaux</p>
            {entry && <LevelRow label="Entry" value={entry} color="text-white" />}
            {sl && <LevelRow label="Stop Loss" value={sl} color="text-red-400" icon={<Shield className="w-3 h-3" />} />}
            {tp1 && <LevelRow label="TP1" value={tp1} color="text-emerald-400" />}
            {tp2 && <LevelRow label="TP2" value={tp2} color="text-emerald-300" />}
            {tp3 && <LevelRow label="TP3" value={tp3} color="text-emerald-200" />}
            {rr && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-gray-500">Risk/Reward</span>
                <span className="text-xs font-mono text-amber-400">1:{rr.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}

        {/* Explanation */}
        {signal.explanation && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Activity className="w-3 h-3" /> Explication</p>
            <p className="text-xs text-gray-300 leading-relaxed">{signal.explanation}</p>
          </div>
        )}

        {/* Candle patterns */}
        {md?.patterns && (md.patterns.pin_bar || md.patterns.engulfing || md.patterns.doji || md.patterns.inside_bar) && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Layers className="w-3 h-3" /> Figures bougies</p>
            <div className="flex flex-wrap gap-1.5">
              {md.patterns.pin_bar && <Tag color="amber" text={md.patterns.pin_bar} />}
              {md.patterns.engulfing && <Tag color="blue" text={md.patterns.engulfing} />}
              {md.patterns.doji && <Tag color="violet" text="Doji" />}
              {md.patterns.inside_bar && <Tag color="gray" text="Inside Bar" />}
            </div>
          </div>
        )}

        {/* Regime */}
        {md?.regime && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Gauge className="w-3 h-3" /> Regime</p>
            <div className="space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Type</span>
                <span className="text-gray-300">{md.regime.regime ?? '—'}</span>
              </div>
              {md.regime.adx != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">ADX</span>
                  <span className="text-gray-300">{md.regime.adx.toFixed(1)}</span>
                </div>
              )}
              {md.regime.trend_strength && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Force</span>
                  <span className="text-gray-300">{md.regime.trend_strength}</span>
                </div>
              )}
              {md.regime.description && (
                <p className="text-xs text-gray-500 mt-1">{md.regime.description}</p>
              )}
            </div>
          </div>
        )}

        {/* MTF Confluence */}
        {md?.mtf_context && (md.mtf_context.mtf_regime || md.mtf_context.htf_regime) && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Layers className="w-3 h-3" /> Confluence MTF</p>
            <div className="space-y-0.5">
              {md.mtf_context.mtf_regime && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">MTF ({md.mtf_context.mtf})</span>
                  <span className="text-gray-300">{md.mtf_context.mtf_regime}</span>
                </div>
              )}
              {md.mtf_context.htf_regime && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">HTF ({md.mtf_context.htf})</span>
                  <span className="text-gray-300">{md.mtf_context.htf_regime}</span>
                </div>
              )}
              {md.mtf_context.confluence && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Confluence</span>
                  <span className={`${
                    md.mtf_context.confluence === 'FULL' ? 'text-emerald-400' :
                    md.mtf_context.confluence === 'PARTIAL' ? 'text-amber-400' :
                    'text-red-400'
                  }`}>{md.mtf_context.confluence}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SMC */}
        {md?.smc && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Brain className="w-3 h-3" /> Smart Money</p>
            <div className="space-y-0.5">
              {md.smc.fvg?.near_bullish_fvg && (
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-400">Bull FVG</span>
                  <span className="text-gray-400 font-mono">{md.smc.fvg.near_bullish_fvg.bottom.toFixed(2)} - {md.smc.fvg.near_bullish_fvg.top.toFixed(2)}</span>
                </div>
              )}
              {md.smc.fvg?.near_bearish_fvg && (
                <div className="flex justify-between text-xs">
                  <span className="text-red-400">Bear FVG</span>
                  <span className="text-gray-400 font-mono">{md.smc.fvg.near_bearish_fvg.bottom.toFixed(2)} - {md.smc.fvg.near_bearish_fvg.top.toFixed(2)}</span>
                </div>
              )}
              {md.smc.ob?.near_bullish_ob && (
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-400">Bull OB</span>
                  <span className="text-gray-400 font-mono">{md.smc.ob.near_bullish_ob.bottom.toFixed(2)} - {md.smc.ob.near_bullish_ob.top.toFixed(2)}</span>
                </div>
              )}
              {md.smc.ob?.near_bearish_ob && (
                <div className="flex justify-between text-xs">
                  <span className="text-red-400">Bear OB</span>
                  <span className="text-gray-400 font-mono">{md.smc.ob.near_bearish_ob.bottom.toFixed(2)} - {md.smc.ob.near_bearish_ob.top.toFixed(2)}</span>
                </div>
              )}
              {md.smc.liquidity?.near_eqh && (
                <div className="flex justify-between text-xs">
                  <span className="text-violet-400">EQH</span>
                  <span className="text-gray-400 font-mono">{md.smc.liquidity.near_eqh.price.toFixed(2)}</span>
                </div>
              )}
              {md.smc.liquidity?.near_eql && (
                <div className="flex justify-between text-xs">
                  <span className="text-pink-400">EQL</span>
                  <span className="text-gray-400 font-mono">{md.smc.liquidity.near_eql.price.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ML */}
        {md?.ml_confidence != null && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Brain className="w-3 h-3" /> Machine Learning</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">ML Confiance</span>
              <span className="text-gray-300">{Math.round(md.ml_confidence * 100)}%</span>
            </div>
            {md.ml_regime && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">ML Regime</span>
                <span className="text-sky-300">{md.ml_regime}</span>
              </div>
            )}
          </div>
        )}

        {/* Risk */}
        {md?.risk_level && (
          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Risque</p>
            <span className={`text-xs px-2 py-0.5 rounded ${
              md.risk_level === 'EXTREME' ? 'bg-red-500/20 text-red-400' :
              md.risk_level === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
              md.risk_level === 'MODERATE' ? 'bg-amber-500/20 text-amber-400' :
              'bg-emerald-500/20 text-emerald-400'
            }`}>{md.risk_level}</span>
            {md.risk_level_reasons && md.risk_level_reasons.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {md.risk_level_reasons.slice(0, 3).map((r, i) => (
                  <li key={i} className="text-xs text-gray-500 flex items-start gap-1">
                    <span className="text-gray-600 mt-0.5">•</span> {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* S/R zones */}
        {md?.sr_zones && (md.sr_zones.near_support || md.sr_zones.near_resistance) && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Support / Resistance</p>
            <div className="space-y-0.5">
              {md.sr_zones.near_support && (
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-400">Support</span>
                  <span className="text-gray-400 font-mono">{md.sr_zones.near_support.price.toFixed(2)} ({md.sr_zones.near_support.strength})</span>
                </div>
              )}
              {md.sr_zones.near_resistance && (
                <div className="flex justify-between text-xs">
                  <span className="text-red-400">Resistance</span>
                  <span className="text-gray-400 font-mono">{md.sr_zones.near_resistance.price.toFixed(2)} ({md.sr_zones.near_resistance.strength})</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Timestamp */}
        <div className="pt-2 border-t border-gray-800">
          <p className="text-xs text-gray-600">
            {new Date(signal.createdAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
      </div>
    </div>
  );
}

function LevelRow({ label, value, color, icon }: { label: string; value: number; color: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs flex items-center gap-1 ${color}`}>{icon}{label}</span>
      <span className={`text-xs font-mono ${color}`}>{value.toFixed(4)}</span>
    </div>
  );
}

function Tag({ color, text }: { color: string; text: string }) {
  const colorMap: Record<string, string> = {
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    gray: 'bg-gray-700 text-gray-400 border-gray-600',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colorMap[color] ?? colorMap.gray}`}>
      {text}
    </span>
  );
}
