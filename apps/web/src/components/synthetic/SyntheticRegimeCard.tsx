'use client';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

export interface SyntheticAnalysis {
  symbol: string;
  deriv_symbol: string;
  category: string;
  last_price: number;
  regime: string;
  state: string;
  spike_probability: number;
  mean_reversion_prob: number;
  atr_z: number;
  bb_width_z: number;
  expected_range: [number, number];
  monte_carlo: { p10: number; p50: number; p90: number };
  caution: boolean;
  source: string;
}

export interface SyntheticRegimeCardProps {
  analysis: SyntheticAnalysis;
  color?: { border: string; text: string; bg: string };
}

const CATEGORY_LABELS: Record<string, string> = {
  volatility: 'Volatility',
  boom_crash: 'Boom/Crash',
  jump: 'Jump',
  step: 'Step',
};

export function SyntheticRegimeCard({ analysis, color }: SyntheticRegimeCardProps) {
  const colorStyle = color ?? { border: 'border-gray-700', text: 'text-gray-400', bg: 'bg-gray-800' };

  if (!CATEGORY_LABELS[analysis.category]) {
    return (
      <div className="bg-gray-900 border border-red-400/20 rounded-xl p-5">
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4" />
          Marché non synthétique
        </div>
      </div>
    );
  }

  const trend = analysis.regime.includes('EXPANSION') || analysis.regime.includes('SPIKE')
    ? 'spike'
    : analysis.regime.includes('COMPRESSION') || analysis.regime.includes('LOW')
    ? 'range'
    : 'neutral';

  return (
    <div className={`bg-gray-900 border rounded-xl p-5 ${colorStyle.border}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold">{analysis.symbol}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${colorStyle.bg} ${colorStyle.text}`}>{analysis.category}</span>
        </div>
        <span className={`text-xs font-mono ${analysis.source === 'live' ? 'text-emerald-400' : 'text-gray-500'}`}>
          {analysis.source}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="text-2xl font-bold text-white">{analysis.last_price?.toLocaleString() ?? '—'}</div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
          trend === 'spike' ? 'bg-red-400/10 text-red-400' :
          trend === 'range' ? 'bg-yellow-400/10 text-yellow-400' :
          'bg-gray-800 text-gray-400'
        }`}>
          {trend === 'spike' ? <TrendingUp className="w-3 h-3" /> :
           trend === 'range' ? <Minus className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {analysis.regime}
        </div>
      </div>

      <div className="space-y-3">
        <GaugeRow label="Spike prob" value={analysis.spike_probability} color={analysis.spike_probability > 50 ? 'text-red-400' : 'text-gray-400'} />
        <GaugeRow label="Mean rev." value={analysis.mean_reversion_prob} color="text-blue-400" />
        <GaugeRow label="ATR z-score" value={Math.min(100, Math.max(0, (analysis.atr_z + 3) * 16.6))} display={`${analysis.atr_z.toFixed(2)}`} color="text-purple-400" />
      </div>

      {analysis.caution && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2" data-testid="caution-alert">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400">Régime instable — éviter les positions grandes tailles</p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-center">
        <div className="bg-gray-950 rounded p-2">
          <p className="text-gray-500">Range</p>
          <p className="text-gray-300 font-mono">{analysis.expected_range?.[0]?.toFixed(2) ?? '—'} - {analysis.expected_range?.[1]?.toFixed(2) ?? '—'}</p>
        </div>
        <div className="bg-gray-950 rounded p-2">
          <p className="text-gray-500">MC p10</p>
          <p className="text-gray-300 font-mono">{analysis.monte_carlo?.p10?.toFixed(2) ?? '—'}</p>
        </div>
        <div className="bg-gray-950 rounded p-2">
          <p className="text-gray-500">MC p90</p>
          <p className="text-gray-300 font-mono">{analysis.monte_carlo?.p90?.toFixed(2) ?? '—'}</p>
        </div>
      </div>
    </div>
  );
}

function GaugeRow({ label, value, display, color }: { label: string; value: number; display?: string; color: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className={`font-mono ${color}`}>{display ?? `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
