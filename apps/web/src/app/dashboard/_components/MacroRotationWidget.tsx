'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Activity, Bitcoin, Coins, Rocket, ShieldAlert, ArrowRight } from 'lucide-react';

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
    case 'BTC': return <Bitcoin className="w-7 h-7 text-orange-400" />;
    case 'ETH': return <Coins className="w-7 h-7 text-blue-400" />;
    case 'ALTCOINS': return <Coins className="w-7 h-7 text-emerald-400" />;
    case 'MEMECOINS': return <Rocket className="w-7 h-7 text-pink-400" />;
    case 'RISK_OFF': return <ShieldAlert className="w-7 h-7 text-red-400" />;
    default: return <Activity className="w-7 h-7 text-gray-400" />;
  }
};

const phaseColor = (phase: string) => {
  switch (phase) {
    case 'BTC': return 'border-orange-500/30 bg-orange-500/5';
    case 'ETH': return 'border-blue-500/30 bg-blue-500/5';
    case 'ALTCOINS': return 'border-emerald-500/30 bg-emerald-500/5';
    case 'MEMECOINS': return 'border-pink-500/30 bg-pink-500/5';
    case 'RISK_OFF': return 'border-red-500/30 bg-red-500/5';
    default: return 'border-gray-700 bg-gray-900/50';
  }
};

export function MacroRotationWidget() {
  const { data, isLoading } = useQuery<RotationData>({
    queryKey: ['macro-rotation'],
    queryFn: async () => (await api.get('/engine/macro/rotation')).data,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 min-h-[96px] flex items-center">
        <p className="text-sm text-gray-500">Chargement de la rotation macro...</p>
      </div>
    );
  }

  return (
    <Link
      href="/macro-rotation"
      className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition-colors group"
    >
      <div className={`flex items-center justify-between gap-4 p-4 rounded-lg border ${phaseColor(data.phase)}`}>
        <div className="flex items-center gap-3">
          {phaseIcon(data.phase)}
          <div>
            <p className="text-xs text-gray-500">Phase de rotation</p>
            <p className="text-white font-semibold">{data.phase_label}</p>
            <p className="text-[10px] text-gray-400 line-clamp-1 max-w-[260px]">{data.phase_description}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-500">Confiance</p>
          <p className="text-xl font-bold text-white">{data.confidence}%</p>
          <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-emerald-400 transition-colors ml-auto mt-1" />
        </div>
      </div>
      {data.warning && (
        <p className="text-[11px] text-yellow-400 mt-2">{data.warning}</p>
      )}
    </Link>
  );
}
