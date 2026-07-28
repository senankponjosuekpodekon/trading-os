'use client';
import { useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Activity, Flame, Gauge, Globe, TrendingUp } from 'lucide-react';

interface FearGreedPoint {
  value: number;
  classification: string;
}

interface FundingRate {
  symbol: string;
  fundingRate: number;
}

interface Basis {
  symbol: string;
  spotPrice: number;
  perpPrice: number;
  basis: number;
}

interface OnChainSnapshot {
  price: number;
  marketCap: number;
  transactions24h: number;
  avgFee24h: number;
}

const ASSETS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];

function scoreColor(value: number, min: number, max: number) {
  if (max === min) return 'bg-gray-800';
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  if (t > 0.66) return 'bg-emerald-500/30 text-emerald-300 border-emerald-500/30';
  if (t > 0.33) return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
  return 'bg-red-500/20 text-red-300 border-red-500/30';
}

function fundingImpact(rate: number) {
  const annual = rate * 3 * 365;
  if (annual > 30) return { label: 'Chaud', color: 'text-red-400' };
  if (annual < -30) return { label: 'Frais', color: 'text-emerald-400' };
  return { label: 'Neutre', color: 'text-gray-400' };
}

export default function HeatmapPage() {
  const { data: fearGreed } = useQuery<FearGreedPoint[]>({
    queryKey: ['market-data', 'fear-greed'],
    queryFn: async () => (await api.get('/market-data/fear-greed')).data,
    staleTime: 300_000,
  });

  const { data: funding = [] } = useQuery<FundingRate[]>({
    queryKey: ['market-data', 'funding-rates'],
    queryFn: async () => (await api.get('/market-data/funding-rates')).data,
    staleTime: 300_000,
  });

  const { data: basis = [] } = useQuery<Basis[]>({
    queryKey: ['market-data', 'basis'],
    queryFn: async () => (await api.get('/market-data/basis')).data,
    staleTime: 300_000,
  });

  const onChain = useQueries({
    queries: ['btc', 'eth'].map(symbol => ({
      queryKey: ['market-data', 'on-chain', symbol],
      queryFn: async () => (await api.get(`/market-data/on-chain/${symbol}`)).data as OnChainSnapshot,
      staleTime: 300_000,
    })),
  });

  const [btcChain, ethChain] = onChain;

  const rows = useMemo(() => {
    return ASSETS.map(symbol => {
      const fund = funding.find(f => f.symbol === symbol);
      const bas = basis.find(b => b.symbol === symbol);
      const isEth = symbol.startsWith('ETH');
      const isBtc = symbol.startsWith('BTC');
      const chain = isBtc ? btcChain.data : isEth ? ethChain.data : null;
      const annualFunding = (fund?.fundingRate ?? 0) * 3 * 365;
      const basisPct = bas ? (bas.basis / bas.spotPrice) * 100 : 0;
      return { symbol, fund, bas, chain, annualFunding, basisPct };
    });
  }, [funding, basis, btcChain.data, ethChain.data]);

  const fng = fearGreed?.[0];

  return (
    <AppLayout title="Heatmap marchés">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" />Heatmap marchés
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Vue synthétique du sentiment, funding, basis et on-chain par actif.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col items-center justify-center">
            <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><Gauge className="w-3 h-3" /> Fear & Greed</p>
            <p className="text-3xl font-bold text-white">{fng ? fng.value : '—'}</p>
            <p className={`text-xs mt-1 capitalize ${fng && fng.value >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fng ? fng.classification : 'Chargement...'}
            </p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col items-center justify-center">
            <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Prix BTC</p>
            <p className="text-3xl font-bold text-white">${btcChain.data ? btcChain.data.price.toLocaleString() : '—'}</p>
            <p className="text-xs text-gray-500 mt-1">Blockchair on-chain</p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col items-center justify-center">
            <p className="text-xs text-gray-500 mb-2 flex items-center gap-1"><Activity className="w-3 h-3" /> Prix ETH</p>
            <p className="text-3xl font-bold text-white">${ethChain.data ? ethChain.data.price.toLocaleString() : '—'}</p>
            <p className="text-xs text-gray-500 mt-1">Blockchair on-chain</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500">
            <div className="col-span-2">Actif</div>
            <div className="col-span-2">Funding annuel</div>
            <div className="col-span-2">Basis spot-perp</div>
            <div className="col-span-3">Sentiment funding</div>
            <div className="col-span-3">On-chain</div>
          </div>

          {rows.map(row => {
            const fundClass = scoreColor(row.annualFunding, -50, 50);
            const basisClass = scoreColor(row.basisPct, -0.5, 0.5);
            const impact = fundingImpact(row.annualFunding);
            return (
              <div
                key={row.symbol}
                className="grid grid-cols-12 gap-4 px-4 py-4 border-b border-gray-800 last:border-0 items-center text-sm"
              >
                <div className="col-span-2 text-white font-semibold">{row.symbol}</div>
                <div className={`col-span-2 rounded-lg border px-2 py-1 text-center font-mono ${fundClass}`}>
                  {row.fund ? `${row.annualFunding.toFixed(1)}%` : '—'}
                </div>
                <div className={`col-span-2 rounded-lg border px-2 py-1 text-center font-mono ${basisClass}`}>
                  {row.bas ? `${row.basisPct.toFixed(3)}%` : '—'}
                </div>
                <div className={`col-span-3 flex items-center gap-1.5 ${impact.color}`}>
                  <Flame className="w-3.5 h-3.5" />{impact.label}
                </div>
                <div className="col-span-3 text-gray-400 text-xs">
                  {row.chain ? (
                    <span>
                      Tx 24h: {row.chain.transactions24h.toLocaleString()} · Fee moy: ${row.chain.avgFee24h.toFixed(3)}
                    </span>
                  ) : (
                    'Non disponible'
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
