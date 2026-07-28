'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { ProbabilityBar } from '@/components/ui/ProbabilityBar';
import { api } from '@/lib/api';
import { Brain, RefreshCw, Activity, Gauge, Layers, Zap, Scale, BarChart3 } from 'lucide-react';

interface PredictorStatus {
  trained: boolean;
  accuracy: number | null;
  sampleCount: number;
  featureCount: number;
}

interface FeatureWeights {
  trained: boolean;
  accuracy: number | null;
  sampleCount: number;
  featureWeights: Record<string, number> | null;
}

const FEATURE_INPUTS = [
  { key: 'confidence', label: 'Confidence', min: 0, max: 100, icon: Gauge },
  { key: 'scoreTotal', label: 'Score total', min: 0, max: 100, icon: Activity },
  { key: 'scoreTrend', label: 'Score trend', min: 0, max: 100, icon: TrendIcon },
  { key: 'scoreStructure', label: 'Score structure', min: 0, max: 100, icon: Layers },
  { key: 'scoreMomentum', label: 'Score momentum', min: 0, max: 100, icon: Zap },
  { key: 'scoreVolatility', label: 'Score volatilité', min: 0, max: 100, icon: BarChart3 },
  { key: 'scoreSR', label: 'Score S/R', min: 0, max: 100, icon: Scale },
  { key: 'scoreMacro', label: 'Score macro', min: 0, max: 100, icon: Activity },
  { key: 'riskReward', label: 'Risk/Reward', min: 0.1, max: 10, step: 0.1, icon: Gauge },
];

function TrendIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 7L13.5 15.5L8.5 10.5L2 17"/><path d="M16 7H22V13"/></svg>
  );
}

export default function FeaturesPage() {
  const qc = useQueryClient();
  const [market, setMarket] = useState('');
  const [inputs, setInputs] = useState<Record<string, number>>({
    confidence: 70,
    scoreTotal: 60,
    scoreTrend: 60,
    scoreStructure: 60,
    scoreMomentum: 60,
    scoreVolatility: 60,
    scoreSR: 60,
    scoreMacro: 60,
    riskReward: 2,
  });
  const [prediction, setPrediction] = useState<{ probability: number; featuresUsed: string[] } | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<PredictorStatus>({
    queryKey: ['predictor-status'],
    queryFn: async () => (await api.get('/signals/predictor/status')).data,
    staleTime: 60_000,
  });

  const { data: weights, isLoading: weightsLoading } = useQuery<FeatureWeights>({
    queryKey: ['predictor-weights'],
    queryFn: async () => (await api.get('/signals/predictor/weights')).data,
    staleTime: 60_000,
  });

  const train = useMutation({
    mutationFn: async () => (await api.post('/signals/predictor/train', {}, { params: market ? { market } : undefined })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['predictor-status'] });
      qc.invalidateQueries({ queryKey: ['predictor-weights'] });
    },
  });

  const predict = useMutation({
    mutationFn: async () => (await api.post('/signals/predictor/predict', inputs)).data,
    onSuccess: (data) => setPrediction(data),
  });

  const isLoading = statusLoading || weightsLoading;

  if (isLoading) {
    return (
      <AppLayout title="Feature Factory">
        <PageSkeleton statCards={3} tableRows={0} />
      </AppLayout>
    );
  }

  const sortedWeights = weights?.featureWeights
    ? Object.entries(weights.featureWeights).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <AppLayout title="Feature Factory">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-emerald-400" />
            Feature Factory Inspector
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Poids du prédicteur de signaux, calibration et prédiction rapide.</p>
        </div>

        {/* Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${status?.trained ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <p className="text-gray-500 text-xs">Statut</p>
              <p className="text-white font-semibold">{status?.trained ? 'Entraîné' : 'Non entraîné'}</p>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <p className="text-gray-500 text-xs">Accuracy</p>
              <p className="text-white font-semibold">{status?.accuracy ? `${(status.accuracy * 100).toFixed(1)}%` : '—'}</p>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <p className="text-gray-500 text-xs">Samples</p>
              <p className="text-white font-semibold">{status?.sampleCount ?? 0}</p>
            </div>
          </div>
        </div>

        {/* Training */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-white font-semibold text-sm">Entraînement</h3>
              <p className="text-gray-500 text-xs mt-0.5">Ré-entraîne le modèle logistique sur les derniers outcomes de signaux.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={market}
                onChange={e => setMarket(e.target.value)}
                placeholder="Market (optionnel)"
                className="bg-gray-950 border border-gray-800 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={() => train.mutate()}
                disabled={train.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {train.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                Entraîner
              </button>
            </div>
          </div>
          {train.data && (
            <div className={`p-3 rounded-lg text-xs ${train.data.trained ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'}`}>
              {train.data.trained
                ? `Entraîné sur ${train.data.count} samples — accuracy ${(train.data.accuracy * 100).toFixed(1)}%`
                : `Entraînement impossible : ${train.data.reason}`}
            </div>
          )}
        </div>

        {/* Feature weights */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">Importance des features</h3>
          {sortedWeights.length === 0 ? (
            <div className="text-gray-500 text-sm">Aucun poids disponible. Entraînez le modèle.</div>
          ) : (
            <div className="space-y-3">
              {sortedWeights.map(([feature, weight]) => (
                <div key={feature}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400 font-medium">{feature}</span>
                    <span className="text-xs font-mono text-white">{(weight * 100).toFixed(0)}%</span>
                  </div>
                  <ProbabilityBar value={weight * 100} showValue={false} color="purple" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prediction playground */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">Prédiction rapide</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {FEATURE_INPUTS.map(({ key, label, min, max, step, icon: Icon }) => (
              <div key={key}>
                <label className="text-xs text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <Icon className="w-3 h-3" />
                  {label}
                </label>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step ?? 1}
                  value={inputs[key]}
                  onChange={e => setInputs(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                  className="w-full bg-gray-950 border border-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => predict.mutate()}
              disabled={predict.isPending || !status?.trained}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {predict.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Prédire
            </button>
            {prediction && (
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs">Probabilité de win :</span>
                <span className={`text-sm font-bold font-mono ${prediction.probability >= 0.6 ? 'text-emerald-400' : prediction.probability >= 0.45 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {(prediction.probability * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
