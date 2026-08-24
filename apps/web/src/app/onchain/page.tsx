'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { Bitcoin, Cpu, Gauge, Wallet, TrendingUp, Database, Percent, Layers, Search } from 'lucide-react';
import { api } from '@/lib/api';

interface BtcData {
  price: number;
  marketCap: number;
  transactions24h: number;
  mempoolSize: number;
  suggestedFee: number;
}

interface EthData {
  price: number;
  marketCap: number;
  transactions24h: number;
  gasPriceMedian: number;
}

function Metric({ label, value, sub, icon: Icon, color }: { label: string; value: React.ReactNode; sub?: string; icon: any; color: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg bg-gray-800 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-gray-500 text-xs">{label}</p>
        <p className="text-white font-mono font-semibold text-lg">{value}</p>
        {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function OnChainPage() {
  const [symbol, setSymbol] = useState('BTC/USDT');

  const { data: btc, isLoading: btcLoading } = useQuery<BtcData | null>({
    queryKey: ['on-chain-btc'],
    queryFn: async () => (await api.get('/market-data/on-chain/btc')).data,
    staleTime: 300_000,
  });
  const { data: eth, isLoading: ethLoading } = useQuery<EthData | null>({
    queryKey: ['on-chain-eth'],
    queryFn: async () => (await api.get('/market-data/on-chain/eth')).data,
    staleTime: 300_000,
  });

  const { data: btcDominance } = useQuery({
    queryKey: ['onchain-btc-dominance'],
    queryFn: async () => (await api.get('/onchain/btc-dominance')).data,
    staleTime: 300_000,
  });

  const { data: funding } = useQuery({
    queryKey: ['onchain-funding', symbol],
    queryFn: async () => (await api.get(`/onchain/funding/${symbol}`)).data,
    staleTime: 120_000,
  });

  const { data: basis } = useQuery({
    queryKey: ['onchain-spot-perp-basis', symbol],
    queryFn: async () => (await api.get(`/onchain/spot-perp-basis/${symbol}`)).data,
    staleTime: 120_000,
  });

  if (btcLoading || ethLoading) {
    return (
      <AppLayout title="On-chain">
        <PageSkeleton statCards={4} tableRows={0} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="On-chain">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            On-chain Dashboard
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Indicateurs blockchain BTC et ETH en temps réel.</p>
        </div>

        <section>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Bitcoin className="w-4 h-4 text-orange-400" />
            Bitcoin
          </h3>
          {btc ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Metric label="Prix" value={`$${btc.price.toLocaleString('en-US')}`} icon={TrendingUp} color="text-orange-400" />
              <Metric label="Transactions 24h" value={btc.transactions24h.toLocaleString('en-US')} icon={Database} color="text-orange-400" />
              <Metric label="Mempool" value={btc.mempoolSize.toLocaleString('en-US')} sub="transactions en attente" icon={Wallet} color="text-orange-400" />
              <Metric label="Fee recommandée" value={`${btc.suggestedFee} sat/vB`} icon={Gauge} color="text-orange-400" />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">Données BTC indisponibles</div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            Ethereum
          </h3>
          {eth ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Metric label="Prix" value={`$${eth.price.toLocaleString('en-US')}`} icon={TrendingUp} color="text-indigo-400" />
              <Metric label="Transactions 24h" value={eth.transactions24h.toLocaleString('en-US')} icon={Database} color="text-indigo-400" />
              <Metric label="Gas median" value={`${eth.gasPriceMedian} gwei`} icon={Gauge} color="text-indigo-400" />
              <Metric label="Market cap" value={`$${(eth.marketCap / 1e9).toFixed(1)}B`} icon={Wallet} color="text-indigo-400" />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">Données ETH indisponibles</div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Percent className="w-4 h-4 text-yellow-400" /> BTC Dominance
          </h3>
          {btcDominance ? (
            <div className="grid grid-cols-2 gap-4">
              <Metric label="BTC Dominance" value={`${(btcDominance.dominance_pct ?? 0).toFixed(2)}%`} sub={btcDominance.timestamp ? new Date(btcDominance.timestamp).toLocaleString() : '—'} icon={Percent} color="text-yellow-400" />
              <Metric label="Dominance 24h" value={`${(btcDominance.change_24h_pct ?? 0).toFixed(2)}%`} icon={TrendingUp} color={btcDominance.change_24h_pct >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">BTC dominance unavailable</div>
          )}
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" /> Derivatives ({symbol})
          </h3>
          <div className="flex items-center gap-2 mb-4">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded px-3 py-1 text-sm text-white focus:outline-none focus:border-cyan-500"
              placeholder="BTC/USDT"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {funding ? (
              <div className="bg-gray-950 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Funding</p>
                <p className="text-white font-mono text-lg">{(funding.funding_rate ?? 0).toFixed(4)}%</p>
                <p className="text-xs text-gray-500">{funding.exchange || '—'} · {funding.interval || '8h'}</p>
              </div>
            ) : <div className="bg-gray-950 rounded-lg p-4 text-sm text-gray-500">Funding data unavailable</div>}
            {basis ? (
              <div className="bg-gray-950 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Spot-Perp Basis</p>
                <p className="text-white font-mono text-lg">{(basis.basis_pct ?? 0).toFixed(2)}%</p>
                <p className="text-xs text-gray-500">Spot ${(basis.spot_price ?? 0).toLocaleString()} · Perp ${(basis.perp_price ?? 0).toLocaleString()}</p>
              </div>
            ) : <div className="bg-gray-950 rounded-lg p-4 text-sm text-gray-500">Basis data unavailable</div>}
          </div>
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Interprétation rapide</h3>
          <ul className="space-y-2 text-xs text-gray-400">
            <li><span className="text-emerald-400">Mempool faible + fee bas</span> = faible congestion, frais entrants limités.</li>
            <li><span className="text-yellow-400">Mempool haut / fee élevé</span> = forte demande de settlement, possible volatilité à court terme.</li>
            <li><span className="text-indigo-400">Gas ETH médian élevé</span> = forte activité on-chain, soutien prix si corrélé à l&apos;utilisation réelle.</li>
          </ul>
        </section>
      </div>
    </AppLayout>
  );
}
