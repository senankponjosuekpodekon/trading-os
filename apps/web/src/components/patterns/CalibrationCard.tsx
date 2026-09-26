'use client';

import { CalibrationResponse } from '@/types';
import { Gauge } from 'lucide-react';

/**
 * Calibration du scoring : pour chaque bucket de confiance prédite,
 * compare le win rate réel mesuré au win rate attendu (milieu du bucket).
 * Un score bien calibré a un winRate réel ≈ la confiance affichée.
 */
export function CalibrationCard({ data }: { data: CalibrationResponse }) {
  const buckets = Object.entries(data?.buckets ?? {})
    .filter(([, b]) => b.total > 0)
    .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));

  if (buckets.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-6 text-sm text-gray-500">
        Aucune donnée de calibration — les signaux doivent être résolus pour mesurer l&apos;écart prédiction/réalité.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-indigo-400" />
          <span className="text-sm font-medium text-white">Confiance prédite vs win rate réel</span>
        </div>
        <span className="text-xs text-gray-500">{data.total} signaux résolus</span>
      </div>

      <div className="space-y-2.5">
        {buckets.map(([range, b]) => {
          const expected = parseInt(range, 10) + 5; // milieu du bucket "60-70" → 65%
          const actual = b.winRate ?? 0;
          const delta = actual - expected;
          const ok = delta >= -10; // tolérance ±10pts
          return (
            <div key={range} className="grid grid-cols-[70px_1fr_120px] items-center gap-3">
              <span className="text-xs font-mono text-gray-400">{range}%</span>
              <div className="relative h-5 rounded bg-gray-800 overflow-hidden">
                {/* win rate réel */}
                <div
                  className={`absolute inset-y-0 left-0 rounded ${ok ? 'bg-emerald-500/70' : 'bg-amber-500/70'}`}
                  style={{ width: `${Math.min(100, actual)}%` }}
                />
                {/* marqueur de la confiance attendue */}
                <div
                  className="absolute inset-y-0 w-0.5 bg-white/70"
                  style={{ left: `${expected}%` }}
                  title={`Attendu ≈ ${expected}%`}
                />
              </div>
              <div className="text-right">
                <span className={`text-xs font-mono ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {actual.toFixed(0)}% réel
                </span>
                <span className="text-xs text-gray-600 ml-2">n={b.total}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500/70" /> réel ≥ attendu (±10pts)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500/70" /> sur-estimation du score
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-white/70 inline-block" /> confiance annoncée
        </span>
      </div>
    </div>
  );
}
