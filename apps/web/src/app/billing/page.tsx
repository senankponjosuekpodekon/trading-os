'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { CreditCard, Check, X, Loader2, Crown, AlertCircle, Gauge } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  code: string;
  price: number;
  interval: 'MONTH' | 'YEAR';
  maxStrategies: number | null;
  maxSignals: number | null;
  maxPortfolios: number | null;
  features: string[];
}

interface Subscription {
  id: string;
  status: 'ACTIVE' | 'TRIAL' | 'CANCELLED' | 'PAST_DUE' | 'EXPIRED';
  currentPeriodEnd: string;
  plan: Plan;
}

interface Usage {
  plan: { name: string; code: string } | null;
  portfolios: { used: number; limit: number | null };
  strategies: { used: number; limit: number | null };
  signals: { used: number; limit: number | null };
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const nearLimit = limit !== null && pct >= 80;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className={nearLimit ? 'text-yellow-400' : 'text-gray-500'}>
          {used} / {limit ?? '∞'}
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${nearLimit ? 'bg-yellow-500' : 'bg-emerald-500'}`}
          style={{ width: limit ? `${pct}%` : '0%' }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const qc = useQueryClient();

  const { data: plans, isLoading: loadingPlans } = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: async () => (await api.get('/billing/plans')).data,
  });

  const { data: subscription, isLoading: loadingSub } = useQuery<Subscription | null>({
    queryKey: ['subscription'],
    queryFn: async () => (await api.get('/billing/subscription')).data,
  });

  const { data: usage } = useQuery<Usage>({
    queryKey: ['billing-usage'],
    queryFn: async () => (await api.get('/billing/usage')).data,
  });

  const subscribe = useMutation({
    mutationFn: (code: string) => api.post(`/billing/subscribe/${code}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['billing-usage'] });
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post('/billing/cancel', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      qc.invalidateQueries({ queryKey: ['billing-usage'] });
    },
  });

  const isLoading = loadingPlans || loadingSub;

  return (
    <AppLayout title="Abonnement">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-emerald-400" />Abonnement
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Gérez votre plan et vos avantages.</p>
        </div>

        {subscription && (
          <div className="bg-gray-900 border border-emerald-500/20 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Plan actuel</p>
              <div className="flex items-center gap-2 text-white font-semibold">
                <Crown className="w-4 h-4 text-emerald-400" />
                {subscription.plan.name}
                <span className={`text-[10px] px-2 py-0.5 rounded border ${
                  subscription.status === 'TRIAL' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                }`}>
                  {subscription.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Renouvellement / fin période : {new Date(subscription.currentPeriodEnd).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <button
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending || subscription.status === 'CANCELLED'}
              className="flex items-center justify-center gap-1.5 px-4 py-2 border border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {cancel.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <X className="w-3.5 h-3.5" />Annuler
            </button>
          </div>
        )}

        {usage && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">
              <Gauge className="w-4 h-4 text-emerald-400" />Utilisation
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <UsageBar label="Portfolios" used={usage.portfolios.used} limit={usage.portfolios.limit} />
              <UsageBar label="Stratégies actives" used={usage.strategies.used} limit={usage.strategies.limit} />
              <UsageBar label="Signaux / jour" used={usage.signals.used} limit={usage.signals.limit} />
            </div>
          </div>
        )}

        {isLoading && (
          <div className="text-center text-gray-600 text-sm py-10">Chargement des plans...</div>
        )}

        {!isLoading && plans && plans.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-10">Aucun plan disponible.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans?.map(plan => {
            const active = subscription?.plan.code === plan.code;
            return (
              <div
                key={plan.code}
                className={`bg-gray-900 border rounded-xl p-5 flex flex-col ${
                  active ? 'border-emerald-500/40' : 'border-gray-800'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-semibold">{plan.name}</h3>
                  {active && <Check className="w-4 h-4 text-emerald-400" />}
                </div>
                <p className="text-2xl font-bold text-white mb-1">
                  ${plan.price}
                  <span className="text-xs text-gray-500 font-normal">/{plan.interval === 'YEAR' ? 'an' : 'mois'}</span>
                </p>
                <ul className="space-y-2 mt-4 mb-6 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-400" />{f}
                    </li>
                  ))}
                  {plan.maxStrategies !== null && (
                    <li className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-400" />{plan.maxStrategies} stratégies max
                    </li>
                  )}
                  {plan.maxSignals !== null && (
                    <li className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-400" />{plan.maxSignals} signaux / jour
                    </li>
                  )}
                  {plan.maxPortfolios !== null && (
                    <li className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-emerald-400" />{plan.maxPortfolios} portfolios
                    </li>
                  )}
                </ul>
                <button
                  onClick={() => subscribe.mutate(plan.code)}
                  disabled={active || subscribe.isPending}
                  className="w-full py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 bg-emerald-500 hover:bg-emerald-400 text-white"
                >
                  {subscribe.isPending && subscribe.variables === plan.code ? (
                    <span className="flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Chargement...</span>
                  ) : active ? (
                    'Plan actif'
                  ) : (
                    'Souscrire'
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-gray-500 mt-0.5" />
          <p className="text-xs text-gray-500">
            Le passage à un plan démarre immédiatement une période d’essai. La facturation réelle via Stripe/Braintree n’est pas encore branchée.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
