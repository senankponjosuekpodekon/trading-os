'use client';
import { Trophy, TrendingUp } from 'lucide-react';

interface ChampionModelBadgeProps {
  modelVersion: string;
  winRate: number;
  profitFactor: number;
  sharpe: number;
}

export function ChampionModelBadge({ modelVersion, winRate, profitFactor, sharpe }: ChampionModelBadgeProps) {
  const healthy = winRate >= 55 && profitFactor >= 1.5 && sharpe >= 1;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
      <div className={`p-3 rounded-full ${healthy ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
        <Trophy className="w-6 h-6" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold text-sm">Modèle actif</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 font-mono">{modelVersion}</span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {healthy
            ? 'Seuil de champion atteint : WR ≥ 55%, PF ≥ 1.5, Sharpe ≥ 1.'
            : 'Pas encore champion — améliorer le R/R ou la qualité des setups.'}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-bold">
        <TrendingUp className="w-4 h-4" />
        {healthy ? 'Champion' : 'En cours'}
      </div>
    </div>
  );
}
