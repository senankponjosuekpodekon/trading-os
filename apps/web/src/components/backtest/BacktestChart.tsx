'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Kline {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Signal {
  type: 'entry' | 'exit';
  bar_index: number;
  time: string;
  direction: 'BUY' | 'SELL' | string;
  price: number;
  sl?: number;
  tp1?: number;
  confidence?: number;
  pattern?: string;
  reasons?: string[];
  exit_reason?: 'TP' | 'SL' | 'TIMEOUT' | string;
  intrabar_ambiguous?: boolean;
}

interface BacktestChartProps {
  klines: Kline[];
  signals: Signal[];
  height?: number;
}

export function BacktestChart({ klines, signals, height = 420 }: BacktestChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { candles, marks, yMin, yMax } = useMemo(() => {
    if (!klines.length) return { candles: [], marks: [], yMin: 0, yMax: 0 };
    const pad = { top: 24, right: 48, bottom: 28, left: 64 };
    const plotW = Math.max(width - pad.left - pad.right, 100);
    const plotH = Math.max(height - pad.top - pad.bottom, 100);

    const n = klines.length;
    const candleW = plotW / n * 0.7;
    const step = plotW / n;

    const lows = klines.map((k) => k.low);
    const highs = klines.map((k) => k.high);
    const globalMin = Math.min(...lows);
    const globalMax = Math.max(...highs);
    const range = globalMax - globalMin || 1;
    const yMin = globalMin - range * 0.02;
    const yMax = globalMax + range * 0.02;

    const y = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const x = (i: number) => pad.left + i * step + step / 2;

    const candles = klines.map((k, i) => {
      const cx = x(i);
      const top = y(Math.max(k.open, k.close));
      const bottom = y(Math.min(k.open, k.close));
      const highY = y(k.high);
      const lowY = y(k.low);
      const green = k.close >= k.open;
      return {
        key: i,
        x: cx,
        bodyTop: top,
        bodyBottom: bottom,
        bodyLeft: cx - candleW / 2,
        bodyRight: cx + candleW / 2,
        wickTop: highY,
        wickBottom: lowY,
        green,
        ...k,
      };
    });

    const marks = signals.map((s) => {
      const i = s.bar_index;
      if (i < 0 || i >= n) return null;
      const cx = x(i);
      const yp = y(s.price);
      const entry = s.type === 'entry';
      const color = s.type === 'entry'
        ? s.direction === 'BUY' ? '#10b981' : '#ef4444'
        : s.exit_reason === 'TP'
          ? '#10b981'
          : s.exit_reason === 'SL'
            ? '#ef4444'
            : '#9ca3af';
      const label = entry
        ? (s.direction === 'BUY' ? 'B' : 'S')
        : (s.exit_reason?.[0] ?? 'X');
      const yOffset = entry ? -10 : 10;
      const markerY = yp + yOffset;
      const slY = s.sl ? y(s.sl) : undefined;
      const tpY = s.tp1 ? y(s.tp1) : undefined;
      return {
        key: `${s.type}-${i}`,
        cx,
        cy: markerY,
        priceY: yp,
        slY,
        tpY,
        color,
        label,
        ...s,
      };
    }).filter(Boolean);

    return { candles, marks, yMin, yMax, pad };
  }, [klines, signals, width, height]);

  if (!klines.length) return null;

  const pad = (candles as any).pad ?? { top: 24, right: 48, bottom: 28, left: 64 };
  const plotH = height - pad.top - pad.bottom;
  const formatPrice = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const formatTime = (t: string) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div ref={wrapperRef} className="w-full" style={{ height }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-white">Chart des setups</h3>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Entrée BUY</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Entrée SELL</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500" />TP</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500" />SL</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-gray-400" />Timeout</span>
        </div>
      </div>
      <svg width={width} height={height} className="bg-gray-900 border border-gray-800 rounded-xl">
        {/* Grid horizontale */}
        {Array.from({ length: 6 }).map((_, i) => {
          const v = yMin + (yMax - yMin) * (i / 5);
          const yp = pad.top + (1 - i / 5) * plotH;
          return (
            <g key={`grid-${i}`}>
              <line x1={pad.left} y1={yp} x2={width - pad.right} y2={yp} stroke="#374151" strokeWidth={0.5} strokeDasharray="4" />
              <text x={width - pad.right + 6} y={yp + 4} fill="#9ca3af" fontSize={10}>{formatPrice(v)}</text>
            </g>
          );
        })}

        {/* Bougies */}
        {candles.map((c: any) => (
          <g key={c.key}>
            <line x1={c.x} y1={c.wickTop} x2={c.x} y2={c.wickBottom} stroke={c.green ? '#10b981' : '#ef4444'} strokeWidth={1} />
            <rect
              x={c.bodyLeft}
              y={c.bodyTop}
              width={Math.max(c.bodyRight - c.bodyLeft, 1)}
              height={Math.max(c.bodyBottom - c.bodyTop, 1)}
              fill={c.green ? '#10b981' : '#ef4444'}
              stroke={c.green ? '#10b981' : '#ef4444'}
              strokeWidth={1}
            >
              <title>{formatTime(c.time)}\nO:{formatPrice(c.open)} H:{formatPrice(c.high)} L:{formatPrice(c.low)} C:{formatPrice(c.close)}</title>
            </rect>
          </g>
        ))}

        {/* SL / TP des entrées */}
        {marks.map((m: any) => (
          <g key={`lines-${m.key}`}>
            {m.slY !== undefined && (
              <line x1={m.cx - 14} y1={m.slY} x2={m.cx + 14} y2={m.slY} stroke="#ef4444" strokeWidth={1} strokeDasharray="3" />
            )}
            {m.tpY !== undefined && (
              <line x1={m.cx - 14} y1={m.tpY} x2={m.cx + 14} y2={m.tpY} stroke="#10b981" strokeWidth={1} strokeDasharray="3" />
            )}
          </g>
        ))}

        {/* Marqueurs */}
        {marks.map((m: any) => (
          <g key={m.key}>
            <circle cx={m.cx} cy={m.cy} r={6} fill={m.color} stroke="#000" strokeWidth={1} />
            <text x={m.cx} y={m.cy + 3} textAnchor="middle" fill="#000" fontSize={8} fontWeight="bold">{m.label}</text>
            {m.intrabar_ambiguous && (
              <text x={m.cx + 10} y={m.cy - 8} fill="#f59e0b" fontSize={14} fontWeight="bold">!</text>
            )}
            <title>
              {m.type === 'entry' ? `Entrée ${m.direction}\n` : `Sortie ${m.exit_reason}\n`}
              Prix: {formatPrice(m.price)}\n{formatTime(m.time)}\n{m.confidence !== undefined ? `Confiance: ${m.confidence}%\n` : ''}{m.pattern ? `Pattern: ${m.pattern}\n` : ''}{m.intrabar_ambiguous ? '⚠️ Intrabar ambigu' : ''}
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}
