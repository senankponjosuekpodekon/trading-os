import Link from 'next/link';
import {
  ArrowRight,
  ShieldCheck,
  Signal,
  LineChart,
  Zap,
  Bot,
  BarChart3,
  Activity,
  Sparkles,
} from 'lucide-react';

const partners = ['Binance', 'Bybit', 'Kraken', 'Glassnode', 'TwelveData'];

const valueProps = [
  {
    title: 'Signal Engine 24/7',
    description: 'Détection continue des breaks, ordres bloqués et contextes macro pour 35+ marchés.',
    icon: Signal,
  },
  {
    title: 'ML Regime Classifier',
    description: 'Confidence score, expected move et volatilité rendus disponibles dans l’UI et les notifications.',
    icon: Bot,
  },
  {
    title: 'Pilotage des positions',
    description: 'Trailing stops dynamiques, sizing guidé par la liquidité et synchronisation exchange.',
    icon: ShieldCheck,
  },
];

const highlights = [
  { label: 'Stratégies live', value: '18', meta: '+4 depuis mai' },
  { label: 'Taux de victoire ML', value: '63%', meta: 'rolling 90j' },
  { label: 'Actifs couverts', value: '38', meta: 'crypto · FX · indices' },
];

const roadmap = [
  {
    title: 'Feature Store v2',
    description: 'Snapshots complets des signaux et expected moves journalisés pour entraîner SignalScorer.',
  },
  {
    title: 'Lab multi-stratégies',
    description: 'Walk-forward, stress tests et backtests multi-timeframes directement dans Trading OS.',
  },
  {
    title: 'Phase B feedback',
    description: 'Boucle de feedback manuelle pour recalculer les poids ML et capturer les biais de marché.',
  },
  {
    title: 'SaaS readiness',
    description: 'Abonnements, quotas, audit trail et Sentry sur API/Engine/Web pour la mise en production.',
  },
];

const testimonials = [
  {
    quote:
      'On suit les signaux depuis 3 mois : expected move et regime detection nous évitent les faux breakouts et améliorent le RR.',
    author: 'Jean-Michel · Swing trader',
  },
  {
    quote:
      'Le runbook de collecte est carré, et les notifications ML nous donnent un edge pour prioriser nos entrées.',
    author: 'Stéphan · Desk prop',
  },
];

export default function LandingPage() {
  return (
    <div className="bg-gray-950 text-gray-100">
      <header className="relative overflow-hidden border-b border-gray-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#0f172a,transparent_60%)] opacity-80" />
        <div className="relative max-w-6xl mx-auto px-6 py-24 space-y-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-800 px-4 py-1 text-xs uppercase tracking-[0.3em] text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> Phase C Build
          </div>
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
            <div className="space-y-8">
              <h1 className="text-4xl md:text-6xl font-semibold leading-tight">
                L’OS qui transforme vos signaux en décisions exécutables.
              </h1>
              <p className="text-lg text-gray-300">
                Collectez, scorez et orchestrez vos stratégies swing & intra grâce à un moteur ML relié au marché temps réel,
                à des runbooks de collecte et à des outils de reporting prêts pour le SaaS.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/auth/register"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-400 transition"
                >
                  Rejoindre la bêta
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-2 rounded-full border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-200 hover:border-gray-500"
                >
                  J’ai déjà un accès
                </Link>
              </div>
            </div>
            <div className="rounded-3xl border border-gray-800 bg-gray-900/70 p-6 lg:p-8 space-y-6">
              <div className="flex items-center justify-between text-xs text-gray-400 uppercase">
                <span className="tracking-[0.2em] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" /> Regime classifier
                </span>
                <span>Last update · 3m</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {highlights.map((item) => (
                  <div key={item.label} className="rounded-2xl bg-gray-900 border border-gray-800 p-4">
                    <p className="text-sm text-gray-500">{item.label}</p>
                    <p className="text-2xl font-semibold text-white">{item.value}</p>
                    <p className="text-xs text-emerald-300">{item.meta}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-emerald-300">
                  <Zap className="w-3 h-3" /> Expected Move
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-white">±2.8%</span>
                  <span className="text-gray-300">BTC/USDT · horizon 4h</span>
                </div>
                <p className="text-sm text-gray-200">Confiance ML 67% · Regime volatilité modérée.</p>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <div className="flex items-center gap-1">
                    <BarChart3 className="w-3 h-3" /> 2 140 samples
                  </div>
                  <div className="flex items-center gap-1">
                    <Activity className="w-3 h-3" /> drift stable
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="border-b border-gray-900">
        <div className="max-w-6xl mx-auto px-6 py-12 flex flex-wrap items-center justify-between gap-6 text-gray-500 text-sm uppercase tracking-[0.3em]">
          {partners.map((name) => (
            <span key={name} className="text-gray-500/70">
              {name}
            </span>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20 space-y-12">
        <div className="space-y-3">
          <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Piliers produit</p>
          <h2 className="text-3xl font-semibold">Tout le workflow sur un seul écran.</h2>
          <p className="text-gray-400 max-w-3xl">
            Trading OS capture les signaux, stocke les features, entraîne le modèle puis notifie vos équipes. Chaque module a été
            bâti sur des runbooks réels (data collection, manual testing, reporting Saas) pour garantir la traçabilité.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {valueProps.map((item) => (
            <div key={item.title} className="rounded-3xl border border-gray-900 bg-gray-900/60 p-6 space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400">
                <item.icon className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-semibold text-white">{item.title}</h3>
              <p className="text-sm text-gray-400">{item.description}</p>
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                Voir plus <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-gray-900/40 border-y border-gray-900">
        <div className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12">
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Roadmap immédiate</p>
            <h2 className="text-3xl font-semibold text-white">Prochaines étapes confirmées.</h2>
            <p className="text-gray-400">
              Après la stabilisation Sentry/API/Web et la création du script de métriques, nous attaquons la collecte massive
              pour entraîner SignalScorer et finaliser la responsivité mobile.
            </p>
          </div>
          <div className="space-y-4">
            {roadmap.map((item) => (
              <div key={item.title} className="rounded-3xl border border-gray-800 bg-gray-950/80 p-5">
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-10">
        {testimonials.map((item) => (
          <div key={item.author} className="rounded-3xl border border-gray-900 bg-gray-900/40 p-8 space-y-4">
            <LineChart className="w-10 h-10 text-emerald-400" />
            <p className="text-lg text-gray-200">“{item.quote}”</p>
            <p className="text-sm text-gray-500">{item.author}</p>
          </div>
        ))}
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-24 text-center space-y-6">
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Prêt à passer en production</p>
        <h2 className="text-3xl font-semibold text-white">Lancez votre session de collecte aujourd’hui.</h2>
        <p className="text-gray-400">
          Signez dans le workspace, déclenchez les scripts de métriques et recevez vos premières notifications expected move en
          quelques minutes.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/auth/register"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-400"
          >
            Créer mon compte
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 rounded-full border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-200 hover:border-gray-500"
          >
            Accéder au dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
