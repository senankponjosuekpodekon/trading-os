'use client';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { TrendingUp, AlertTriangle, Activity, Bitcoin, Coins, Rocket, ShieldAlert, RefreshCw } from 'lucide-react';

interface RotationData {
  phase: string;
  phase_label: string;
  phase_description: string;
  confidence: number;
  data: {
    btc_dominance: number;
    btc_change_24h: number;
    eth_btc_change_24h: number;
    altcoins_avg_24h: number;
    altcoins_max_24h: number;
    total_mcap_change_24h: number;
    fear_greed: number;
  };
  implication: string;
  warning: string | null;
}

const phaseIcon = (phase: string) => {
  switch (phase) {
    case 'BTC': return <Bitcoin className="w-8 h-8 text-orange-400" />;
    case 'ETH': return <Coins className="w-8 h-8 text-blue-400" />;
    case 'ALTCOINS': return <Coins className="w-8 h-8 text-purple-400" />;
    case 'MEMECOINS': return <Rocket className="w-8 h-8 text-pink-400" />;
    case 'RISK_OFF': return <ShieldAlert className="w-8 h-8 text-red-400" />;
    default: return <Activity className="w-8 h-8 text-gray-400" />;
  }
};

const phaseColor = (phase: string) => {
  switch (phase) {
    case 'BTC': return 'border-orange-500/30 bg-orange-500/5';
    case 'ETH': return 'border-blue-500/30 bg-blue-500/5';
    case 'ALTCOINS': return 'border-purple-500/30 bg-purple-500/5';
    case 'MEMECOINS': return 'border-pink-500/30 bg-pink-500/5';
    case 'RISK_OFF': return 'border-red-500/30 bg-red-500/5';
    default: return 'border-gray-700 bg-gray-900/50';
  }
};

const phases = ['BTC', 'ETH', 'ALTCOINS', 'MEMECOINS'];

function MetricCard({ label, value, suffix, color }: { label: string; value: number; suffix?: string; color?: string }) {
  const isPositive = value > 0;
  return (
    <div className="flex flex-col gap-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${color || (isPositive ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-white')}`}>
        {isPositive ? '+' : ''}{value}{suffix}
      </p>
    </div>
  );
}

export default function MacroRotationPage() {
  const { data, isLoading } = useQuery<RotationData>({
    queryKey: ['macro-rotation'],
    queryFn: async () => {
      const { data } = await api.get('/engine/macro/rotation');
      return data;
    },
    refetchInterval: 60000,
  });

  return (
    <AppLayout title="Macro Rotation">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Macro Rotation Signal</h1>
          <RefreshCw className="w-4 h-4 text-gray-500 ml-auto" />
        </div>

        {isLoading ? (
          <div className="text-gray-400 text-sm">Chargement...</div>
        ) : data ? (
          <>
            {/* Phase indicator */}
            <div className={`rounded-2xl border p-6 ${phaseColor(data.phase)}`}>
              <div className="flex items-center gap-4">
                {phaseIcon(data.phase)}
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-white">{data.phase_label}</h2>
                  <p className="text-sm text-gray-400 mt-1">{data.phase_description}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Confiance</p>
                  <p className="text-2xl font-bold text-white">{data.confidence}%</p>
                </div>
              </div>

              {/* Phase progression bar */}
              <div className="mt-6 flex items-center gap-2">
                {phases.map((p, i) => (
                  <div key={p} className="flex items-center gap-2 flex-1">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${
                      data.phase === p
                        ? 'border-emerald-400 bg-emerald-400/10 text-emerald-400'
                        : phases.indexOf(data.phase) > i
                        ? 'border-gray-700 bg-gray-800 text-gray-600'
                        : 'border-gray-800 text-gray-600'
                    }`}>
                      {i + 1}
                    </div>
                    <span className={`text-xs ${data.phase === p ? 'text-white font-medium' : 'text-gray-600'}`}>{p}</span>
                    {i < phases.length - 1 && <div className="flex-1 h-px bg-gray-800" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Implication */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Implication trading</h3>
              <p className="text-sm text-white">{data.implication}</p>
            </div>

            {/* Warning */}
            {data.warning && (
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-300">{data.warning}</p>
              </div>
            )}

            {/* Metrics */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-3">Métriques</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="BTC Dominance" value={data.data.btc_dominance} suffix="%" color="text-white" />
                <MetricCard label="BTC 24h" value={data.data.btc_change_24h} suffix="%" />
                <MetricCard label="ETH/BTC 24h" value={data.data.eth_btc_change_24h} suffix="%" />
                <MetricCard label="Altcoins avg 24h" value={data.data.altcoins_avg_24h} suffix="%" />
                <MetricCard label="Altcoins max 24h" value={data.data.altcoins_max_24h} suffix="%" />
                <MetricCard label="Total MCap 24h" value={data.data.total_mcap_change_24h} suffix="%" />
                <MetricCard label="Fear & Greed" value={data.data.fear_greed} color={
                  data.data.fear_greed >= 75 ? 'text-red-400' :
                  data.data.fear_greed >= 55 ? 'text-amber-400' :
                  data.data.fear_greed <= 25 ? 'text-emerald-400' : 'text-white'
                } />
              </div>
            </div>
          </>
        ) : (
          <div className="text-gray-400 text-sm">Données indisponibles</div>
        )}
      </div>
    </AppLayout>
  );
}
