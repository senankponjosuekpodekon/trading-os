'use client';
import Image from 'next/image';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Shield, AlertCircle, CheckCircle, Smartphone } from 'lucide-react';

interface TwoFaStatus {
  enabled: boolean;
}

interface TwoFaSetup {
  secret: string;
  qrCode: string;
  otpauthUrl: string;
}

export default function TwoFactorPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [step, setStep] = useState<'view' | 'setup' | 'disable'>('view');

  const { data: status, isLoading: statusLoading } = useQuery<TwoFaStatus>({
    queryKey: ['2fa-status'],
    queryFn: async () => (await api.get('/auth/2fa/status')).data,
  });

  const setupMutation = useMutation<TwoFaSetup>({
    mutationFn: async () => (await api.post('/auth/2fa/setup')).data,
  });

  const enableMutation = useMutation({
    mutationFn: async (code: string) => (await api.post('/auth/2fa/enable', { token: code })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['2fa-status'] });
      setStep('view');
      setToken('');
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (code: string) => (await api.post('/auth/2fa/disable', { token: code })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['2fa-status'] });
      setStep('view');
      setToken('');
    },
  });

  const startSetup = async () => {
    await setupMutation.mutateAsync();
    setStep('setup');
    setToken('');
  };

  const handleEnable = (e: React.FormEvent) => {
    e.preventDefault();
    enableMutation.mutate(token);
  };

  const handleDisable = (e: React.FormEvent) => {
    e.preventDefault();
    disableMutation.mutate(token);
  };

  return (
    <AppLayout title="2FA">
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />Authentification à deux facteurs
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Sécurisez votre compte avec une application TOTP.</p>
        </div>

        {statusLoading ? (
          <div className="text-gray-500 text-sm">Chargement...</div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${status?.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-400'}`}>
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-white font-medium">2FA {status?.enabled ? 'activée' : 'désactivée'}</p>
                  <p className="text-gray-500 text-sm">
                    {status?.enabled ? 'Votre compte est protégé par TOTP.' : 'Activez-la pour plus de sécurité.'}
                  </p>
                </div>
              </div>
              {status?.enabled ? (
                <button
                  onClick={() => setStep('disable')}
                  className="text-sm px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  Désactiver
                </button>
              ) : (
                <button
                  onClick={startSetup}
                  disabled={setupMutation.isPending}
                  className="text-sm px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  Activer
                </button>
              )}
            </div>

            {step === 'setup' && setupMutation.data && (
              <form onSubmit={handleEnable} className="space-y-4 border-t border-gray-800 pt-4">
                <p className="text-gray-300 text-sm">Scannez ce QR code avec votre application d’authentification.</p>
                <div className="flex justify-center">
                  <Image
                    src={setupMutation.data.qrCode}
                    alt="QR Code 2FA"
                    width={200}
                    height={200}
                    unoptimized
                    className="rounded-lg border border-gray-800"
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">Secret</p>
                  <code className="text-xs text-gray-300 bg-gray-800 px-2 py-1 rounded">{setupMutation.data.secret}</code>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Code de vérification</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    maxLength={6}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    placeholder="123456"
                  />
                </div>
                {enableMutation.error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4" />Code invalide.
                  </div>
                )}
                <button
                  type="submit"
                  disabled={enableMutation.isPending || token.length < 6}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
                >
                  {enableMutation.isPending ? 'Vérification...' : 'Activer 2FA'}
                </button>
              </form>
            )}

            {step === 'disable' && (
              <form onSubmit={handleDisable} className="space-y-4 border-t border-gray-800 pt-4">
                <div className="flex items-start gap-2 text-yellow-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  Entrez un code TOTP pour confirmer la désactivation.
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Code de vérification</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    maxLength={6}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    placeholder="123456"
                  />
                </div>
                {disableMutation.error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4" />Code invalide.
                  </div>
                )}
                <button
                  type="submit"
                  disabled={disableMutation.isPending || token.length < 6}
                  className="w-full py-2.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
                >
                  {disableMutation.isPending ? 'Vérification...' : 'Désactiver 2FA'}
                </button>
              </form>
            )}

            {(enableMutation.isSuccess || disableMutation.isSuccess) && step === 'view' && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm border-t border-gray-800 pt-4">
                <CheckCircle className="w-4 h-4" />Configuration mise à jour.
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
