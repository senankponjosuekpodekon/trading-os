'use client';
import { useMemo } from 'react';

interface CalibrationPoint {
  confidence: number;
  win: boolean;
}

interface CalibrationCurveProps {
  trades: CalibrationPoint[];
}

export function CalibrationCurve({ trades }: CalibrationCurveProps) {
  const points = useMemo(() => {
    if (trades.length < 10) return [];
    const sorted = [...trades].sort((a, b) => a.confidence - b.confidence);
    const bucketSize = Math.max(10, Math.floor(sorted.length / 6));
    const out: { midConfidence: number; actualWinRate: number; count: number }[] = [];
    for (let i = 0; i < sorted.length; i += bucketSize) {
      const slice = sorted.slice(i, i + bucketSize);
      const wins = slice.filter(t => t.win).length;
      const avgConf = slice.reduce((sum, t) => sum + t.confidence, 0) / slice.length;
      out.push({ midConfidence: avgConf, actualWinRate: wins / slice.length, count: slice.length });
    }
    return out;
  }, [trades]);

  if (points.length === 0) return null;

  const w = 400;
  const h = 120;
  const pad = 20;

  const x = (conf: number) => pad + ((conf - 40) / 60) * (w - 2 * pad);
  const y = (rate: number) => h - pad - rate * (h - 2 * pad);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.midConfidence)} ${y(p.actualWinRate)}`).join(' ');

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">Calibration — confiance annoncée vs taux de réussite réel</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28">
        {/* Diagonal perfect calibration */}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={pad} stroke="#374151" strokeWidth="1" strokeDasharray="4" />
        {/* Actual curve */}
        <path d={path} fill="none" stroke="#34d399" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(p.midConfidence)} cy={y(p.actualWinRate)} r="3" fill="#34d399" />
            <text x={x(p.midConfidence)} y={y(p.actualWinRate) - 6} textAnchor="middle" fill="#9ca3af" fontSize="8">
              {(p.actualWinRate * 100).toFixed(0)}%
            </text>
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-gray-500 mt-1 font-mono">
        <span>40% conf</span>
        <span>100% conf</span>
      </div>
    </div>
  );
}
