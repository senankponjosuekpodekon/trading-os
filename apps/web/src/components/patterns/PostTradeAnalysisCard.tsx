'use client';

import { PostTradeAnalysis } from '@/types';
import { AlertTriangle, CheckCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PostTradeAnalysisCardProps {
  analysis: PostTradeAnalysis;
}

export function PostTradeAnalysisCard({ analysis }: PostTradeAnalysisCardProps) {
  const biasIcon = analysis.bias > 0.1
    ? <TrendingUp className="text-green-400" size={20} />
    : analysis.bias < -0.1
      ? <TrendingDown className="text-red-400" size={20} />
      : <Minus className="text-gray-400" size={20} />;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Expected PnL moyen</div>
        <div className="mt-1 text-2xl font-semibold text-white">{analysis.avgExpectedPnlPct.toFixed(2)}%</div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Realized PnL moyen</div>
        <div className={`mt-1 text-2xl font-semibold ${analysis.avgRealizedPnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {analysis.avgRealizedPnlPct >= 0 ? '+' : ''}{analysis.avgRealizedPnlPct.toFixed(2)}%
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Bias</div>
        <div className="mt-1 flex items-center gap-2 text-2xl font-semibold text-white">
          {biasIcon}
          {analysis.bias.toFixed(2)}
        </div>
      </div>

      {(analysis.overestimating || analysis.underestimating) && (
        <div className={`md:col-span-3 flex items-center gap-2 rounded-xl border px-4 py-3 ${analysis.overestimating ? 'border-red-900/50 bg-red-950/20 text-red-300' : 'border-green-900/50 bg-green-950/20 text-green-300'}`}>
          {analysis.overestimating ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
          <span className="text-sm">
            {analysis.overestimating
              ? 'Le modèle surestime les gains attendus. Le scoring doit être ajusté à la baisse.'
              : 'Le modèle sous-estime les gains. Il y a potentiellement marge de confiance.'}
          </span>
        </div>
      )}

      <div className="md:col-span-3 text-xs text-gray-500">
        Basé sur {analysis.sampleSize} signaux résolus.
      </div>
    </div>
  );
}
