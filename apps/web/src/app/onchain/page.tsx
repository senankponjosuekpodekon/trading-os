'use client';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { Bitcoin, Cpu, Gauge, Wallet, TrendingUp, Database } from 'lucide-react';
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
