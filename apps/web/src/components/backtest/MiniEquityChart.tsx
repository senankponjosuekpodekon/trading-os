'use client';

interface MiniEquityChartProps {
  curve: number[];
}

export function MiniEquityChart({ curve }: MiniEquityChartProps) {
  if (curve.length < 2) return null;
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const range = max - min || 1;
  const w = 400;
  const h = 100;
  const pts = curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 10) - 5;
      return `${x},${y}`;
    })
    .join(' ');
  const isPositive = curve[curve.length - 1] >= curve[0];
  const color = isPositive ? '#34d399' : '#f87171';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">Courbe d&apos;équité</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#eqGrad)" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-xs text-gray-600 mt-1">
        <span>${min.toFixed(0)}</span>
        <span>${max.toFixed(0)}</span>
      </div>
    </div>
  );
}
