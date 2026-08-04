'use client';
import { useState } from 'react';
import { Zap, RefreshCw, CheckCircle2, XCircle, Link2 } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';

interface ExchangeConnection {
  id: string;
  exchange: string;
  label: string;
  isActive: boolean;
  apiKeyMasked: string;
}

interface OneClickExecuteProps {
  signal: {
    id: string;
    signal: string;
    asset?: { symbol: string };
    entryPrice?: string | number | null;
  };
}

export function OneClickExecute({ signal }: OneClickExecuteProps) {
  const [showModal, setShowModal] = useState(false);
  const [quantity, setQuantity] = useState('0.001');
  const [selectedConnection, setSelectedConnection] = useState('');
  const [manualTicket, setManualTicket] = useState<string | null>(null);
  const [brokerInstructions, setBrokerInstructions] = useState('');
  const { toast } = useToast();

  const { data: connections, isLoading } = useQuery<ExchangeConnection[]>({
    queryKey: ['exchange-connections'],
    queryFn: async () => (await api.get('/exchange-connections')).data,
    enabled: showModal,
  });

  const activeConnections = connections?.filter(c => c.isActive) ?? [];

  const execute = useMutation({
    mutationFn: (data: any) => api.post('/execution/order', data),
    onSuccess: (res: any) => {
      if (res.status === 'MANUAL' && res.manualTicket) {
        setManualTicket(res.manualTicket);
        setBrokerInstructions(res.brokerInstructions || '');
        toast('Ticket d\'ordre généré. Transmettez-le à votre broker.', { title: 'Ordre manuel BRVM', type: 'warning' });
      } else {
        toast(
          `${res.side} ${res.executedQty} ${signal.asset?.symbol} @ ${res.avgPrice}`,
          { title: 'Ordre exécuté', type: 'success' },
        );
        setShowModal(false);
      }
    },
    onError: (err: any) => {
      toast(
        err?.response?.data?.message || 'Erreur lors de l\'envoi de l\'ordre',
        { title: 'Échec d\'exécution', type: 'error' },
      );
    },
  });

  const handleExecute = () => {
    if (!selectedConnection) {
      toast('Sélectionnez une connexion.', { title: 'Sélectionnez une connexion', type: 'error' });
      return;
    }
    execute.mutate({
      connectionId: selectedConnection,
      symbol: signal.asset?.symbol,
      side: signal.signal,
      type: 'MARKET',
      quantity: parseFloat(quantity),
      signalId: signal.id,
    });
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white font-semibold transition-colors"
      >
        <Zap className="w-3 h-3" />Exécuter
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full mx-4 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-400" />
              <h3 className="text-white font-semibold text-lg">Exécution 1-clic</h3>
            </div>

            {/* Signal summary */}
            <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
              <span className={`text-sm font-bold ${signal.signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                {signal.signal}
              </span>
              <span className="text-white font-medium">{signal.asset?.symbol}</span>
              <span className="text-xs text-gray-500">Market Order</span>
            </div>

            {/* No connections */}
            {!isLoading && activeConnections.length === 0 && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-center">
                <p className="text-yellow-400 text-sm font-medium">Aucune connexion exchange active</p>
                <p className="text-gray-400 text-xs mt-1">Connectez votre exchange pour exécuter des ordres.</p>
                <Link
                  href="/settings/exchanges"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs text-emerald-400 hover:text-emerald-300"
                >
                  <Link2 className="w-3 h-3" />Configurer une connexion
                </Link>
              </div>
            )}

            {/* Connection selector */}
            {activeConnections.length > 0 && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Connexion</label>
                  <select
                    value={selectedConnection}
                    onChange={e => setSelectedConnection(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Sélectionner...</option>
                    {activeConnections.map(c => (
                      <option key={c.id} value={c.id}>{c.exchange} — {c.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Quantité</label>
                  <input
                    type="number"
                    step="0.00000001"
                    min="0.00000001"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>⚠ Ordre réel envoyé à l&rsquo;exchange. Vérifiez la quantité avant de confirmer.</span>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleExecute}
                    disabled={execute.isPending || !selectedConnection}
                    className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    {execute.isPending ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" />Exécution...</>
                    ) : (
                      <><Zap className="w-4 h-4" />Confirmer l&rsquo;ordre</>
                    )}
                  </button>
                </div>
              </>
            )}

            {/* Loading */}
            {isLoading && (
              <div className="flex items-center justify-center py-6 text-gray-600">
                <RefreshCw className="w-4 h-4 animate-spin" />
              </div>
            )}

            {/* Manual ticket (BRVM) */}
            {manualTicket && (
              <div className="space-y-3">
                <div className="p-4 bg-gray-800 border border-gray-700 rounded-lg">
                  <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">{manualTicket}</pre>
                </div>
                {brokerInstructions && (
                  <p className="text-xs text-yellow-400">{brokerInstructions}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(manualTicket);
                      toast('Ticket copié dans le presse-papiers.', { type: 'info' });
                    }}
                    className="px-4 py-2 text-sm border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
                  >
                    Copier le ticket
                  </button>
                  <button
                    onClick={() => { setManualTicket(null); setShowModal(false); }}
                    className="px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg transition-colors"
                  >
                    Fermer
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
