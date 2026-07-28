'use client';
import { useMemo } from 'react';

interface MonteCarloChartProps {
  tradePnls: number[];
  initialCapital: number;
  simulations?: number;
}

export function MonteCarloChart({ tradePnls, initialCapital, simulations = 1000 }: MonteCarloChartProps) {
  const distribution = useMemo(() => {
    if (tradePnls.length < 5) return [];
    const results: number[] = [];
    for (let i = 0; i < simulations; i++) {
      let capital = initialCapital;
      for (let j = 0; j < tradePnls.length; j++) {
        const pick = tradePnls[Math.floor(Math.random() * tradePnls.length)];
        capital += pick;
      }
      results.push(capital);
    }
    results.sort((a, b) => a - b);
    return results;
  }, [tradePnls, initialCapital, simulations]);

  const stats = useMemo(() => {
    if (distribution.length === 0) return null;
    const min = distribution[0];
    const max = distribution[distribution.length - 1];
    const n = 30;
    const step = (max - min) / n || 1;
    const counts = new Array(n).fill(0);
    distribution.forEach(v => {
      const idx = Math.min(n - 1, Math.floor((v - min) / step));
      counts[idx]++;
    });
    return {
      min,
      max,
      p10: distribution[Math.floor(distribution.length * 0.1)],
      p50: distribution[Math.floor(distribution.length * 0.5)],
      p90: distribution[Math.floor(distribution.length * 0.9)],
      buckets: counts,
      maxCount: Math.max(...counts),
    };
  }, [distribution]);

  if (!stats) return null;

  const { min, max, p10, p50, p90, buckets, maxCount } = stats;
  const w = 400;
  const h = 100;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">Monte-Carlo — distribution du capital final ({simulations} sims)</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
        {buckets.map((count, i) => {
          const bw = w / buckets.length;
          const bh = (count / maxCount) * h;
          return (
            <rect
              key={i}
              x={i * bw}
              y={h - bh}
              width={bw - 1}
              height={bh}
              fill="#8b5cf6"
              opacity={0.7}
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-gray-500 mt-2 font-mono">
        <span>P10 ${p10.toFixed(0)}</span>
        <span>Médiane ${p50.toFixed(0)}</span>
        <span>P90 ${p90.toFixed(0)}</span>
      </div>
    </div>
  );
}
