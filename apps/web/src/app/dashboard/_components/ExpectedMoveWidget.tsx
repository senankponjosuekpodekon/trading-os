'use client';

import { Loader2, Activity, ArrowUpRight, Waves } from 'lucide-react';
import { ExpectedMoveResponse, VolatilityRegime } from '@/types';

interface ExpectedMoveWidgetProps {
  data?: ExpectedMoveResponse;
  isLoading: boolean;
  symbol: string;
  timeframe: string;
  symbols: { value: string; label: string }[];
  timeframes: { value: string; label: string }[];
  onSymbolChange: (value: string) => void;
  onTimeframeChange: (value: string) => void;
}

const regimeCopy: Record<VolatilityRegime, { label: string; color: string; bg: string }> = {
  HIGH:   { label: 'Volatilité élevée', color: 'text-red-300',     bg: 'bg-red-500/10 border-red-500/30' },
  NORMAL: { label: 'Volatilité normale', color: 'text-amber-200',   bg: 'bg-amber-400/10 border-amber-400/30' },
  LOW:    { label: 'Volatilité calme',   color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/30' },
};

function formatUsd(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function ExpectedMoveWidget({
  data,
  isLoading,
  symbol,
  timeframe,
  symbols,
  timeframes,
  onSymbolChange,
  onTimeframeChange,
}: ExpectedMoveWidgetProps) {
  const regime = data ? regimeCopy[data.volatility_regime] : undefined;

  return (
    <section className="rounded-2xl border border-white/5 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Expected Move Engine</p>
          <div className="mt-2 flex items-baseline gap-3 text-white">
            <span className="text-2xl font-semibold">{symbol}</span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-300">{timeframe.toUpperCase()}</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">Projection des ranges probables sur la base de l'ATR et du régime de volatilité.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
          >
            {symbols.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={timeframe}
            onChange={(e) => onTimeframeChange(e.target.value)}
            className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
          >
            {timeframes.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
          <p className="text-xs uppercase text-slate-400">Clôture</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatUsd(data?.close)}</p>
          <p className="mt-1 text-xs text-slate-500">ATR 14 : {formatUsd(data?.atr)} ({formatPct(data?.atr_pct)})</p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
          <p className="text-xs uppercase text-slate-400">Percentile ATR</p>
          <div className="mt-2 flex items-baseline gap-2 text-white">
            <span className="text-2xl font-semibold">{data ? `${data.atr_percentile.toFixed(1)}%` : '—'}</span>
            <span className="text-xs text-slate-400">vs historique &ge;120 barres</span>
          </div>
          <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <Activity className="h-3.5 w-3.5" /> Ratio volume : {data?.volume_ratio ? data.volume_ratio.toFixed(2) : '—'}x
          </p>
        </div>

        <div className="rounded-2xl border border-dashed border-white/10 p-4">
          <p className="text-xs uppercase text-slate-400">Régime</p>
          {regime ? (
            <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${regime.bg} ${regime.color}`}>
              <Waves className="h-4 w-4" />
              {regime.label}
            </div>
          ) : (
            <p className="mt-2 text-xl font-semibold text-white">—</p>
          )}
          <p className="mt-1 text-xs text-slate-500">Mesuré via percentile d'ATR. &gt;70% = HIGH.</p>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-xs uppercase text-slate-400">Ranges projetés</p>
        {isLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Calcul en cours…
          </div>
        )}
        {!isLoading && (!data || !data.ranges.length) && (
          <p className="mt-4 text-sm text-slate-500">Pas de projection disponible. Choisis un autre symbole ou timeframe.</p>
        )}
        {!isLoading && data && data.ranges.length > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {data.ranges.map((range) => (
              <div key={range.horizon} className="rounded-2xl border border-white/5 bg-black/30 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{range.horizon} barres</span>
                  <span className="flex items-center gap-1 text-emerald-300">
                    <ArrowUpRight className="h-3 w-3" /> ±{range.move_pct.toFixed(2)}%
                  </span>
                </div>
                <p className="mt-2 text-2xl font-semibold text-white">{formatUsd(range.move)}</p>
                <div className="mt-3 flex flex-col text-sm text-slate-400">
                  <span>Upper : <span className="text-slate-200">{formatUsd(range.upper)}</span></span>
                  <span>Lower : <span className="text-slate-200">{formatUsd(range.lower)}</span></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
