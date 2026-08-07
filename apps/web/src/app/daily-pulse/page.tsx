'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Newspaper, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Clock, Globe } from 'lucide-react';

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const config: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    bullish: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: <TrendingUp className="w-3 h-3" />, label: 'Bullish' },
    bearish: { color: 'text-red-400 bg-red-500/10 border-red-500/20', icon: <TrendingDown className="w-3 h-3" />, label: 'Bearish' },
    neutral: { color: 'text-gray-400 bg-gray-500/10 border-gray-500/20', icon: <Minus className="w-3 h-3" />, label: 'Neutral' },
    'risk-on': { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: <TrendingUp className="w-3 h-3" />, label: 'Risk-On' },
    'risk-off': { color: 'text-red-400 bg-red-500/10 border-red-500/20', icon: <TrendingDown className="w-3 h-3" />, label: 'Risk-Off' },
  };
  const c = config[sentiment] || config.neutral;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${c.color}`}>
      {c.icon} {c.label}
    </span>
  );
}

function PriceRow({ name, data }: { name: string; data: { price: number; change_pct: number } }) {
  const isUp = data.change_pct >= 0;
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-300">{name}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-white">${data.price.toLocaleString()}</span>
        <span className={`text-xs ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
          {isUp ? '+' : ''}{data.change_pct}%
        </span>
      </div>
    </div>
  );
}

export default function DailyPulsePage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['daily-pulse'],
    queryFn: async () => {
      const res = await api.get('/ai/daily-pulse');
      return res.data;
    },
    staleTime: 1000 * 60 * 30,
  });

  const handleRefresh = async () => {
    await api.get('/ai/daily-pulse', { params: { refresh: 'true' } });
    queryClient.invalidateQueries({ queryKey: ['daily-pulse'] });
  };

  const brief = data?.brief;
  const rawData = data?.raw_data;

  return (
    <AppLayout title="Daily Pulse">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Newspaper className="w-6 h-6 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Daily Pulse</h1>
              <p className="text-sm text-gray-500">
                {data?.generated_at ? new Date(data.generated_at).toLocaleString('fr-FR') : 'Chargement...'}
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {isLoading && (
          <div className="space-y-4">
            <div className="h-32 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
            <div className="h-48 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
            <div className="h-48 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
          </div>
        )}

        {isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-red-400">Erreur lors du chargement du Daily Pulse</p>
          </div>
        )}

        {brief && !isLoading && (
          <>
            {/* Headline */}
            <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-2">{brief.headline}</h2>
              {brief.sentiment && (
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs text-gray-500">Sentiment global:</span>
                  <SentimentBadge sentiment={brief.sentiment.overall || brief.sentiment.crypto || 'neutral'} />
                  {brief.sentiment.crypto && <SentimentBadge sentiment={brief.sentiment.crypto} />}
                  {brief.sentiment.forex && <SentimentBadge sentiment={brief.sentiment.forex} />}
                </div>
              )}
            </div>

            {/* Market Summary */}
            {brief.market_summary && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wide">Market Summary</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(brief.market_summary).map(([key, value]) => (
                    <div key={key}>
                      <p className="text-xs text-gray-500 capitalize mb-1">{key}</p>
                      <p className="text-sm text-gray-200">{value as string}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* What Changed */}
            {brief.what_changed?.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wide">What Changed Overnight</h3>
                <ul className="space-y-3">
                  {brief.what_changed.map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="text-blue-400 text-xs mt-1">●</span>
                      <p className="text-sm text-gray-200">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Why It Matters */}
            {brief.why_it_matters?.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wide">Why It Matters</h3>
                <ul className="space-y-3">
                  {brief.why_it_matters.map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="text-amber-400 text-xs mt-1">▲</span>
                      <p className="text-sm text-gray-200">{item}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* What to Watch */}
            {brief.what_to_watch?.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wide">What to Watch Today</h3>
                <div className="space-y-2">
                  {brief.what_to_watch.map((event: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-gray-600" />
                        <span className="text-sm text-gray-200">{event.event}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {event.time && <span className="text-xs text-gray-500">{event.time}</span>}
                        {event.impact && (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            event.impact === 'high' ? 'bg-red-500/10 text-red-400' :
                            event.impact === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                            'bg-gray-500/10 text-gray-400'
                          }`}>
                            {event.impact}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Flags */}
            {brief.risk_flags?.length > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-amber-400 mb-4 uppercase tracking-wide flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Risk Flags
                </h3>
                <ul className="space-y-2">
                  {brief.risk_flags.map((flag: string, i: number) => (
                    <li key={i} className="text-sm text-amber-200/80">• {flag}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Prices */}
            {rawData?.prices && Object.keys(rawData.prices).length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wide flex items-center gap-2">
                  <Globe className="w-4 h-4" /> Key Prices
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  {Object.entries(rawData.prices).map(([name, data]: [string, any]) => (
                    <PriceRow key={name} name={name} data={data} />
                  ))}
                </div>
              </div>
            )}

            {/* Meta */}
            <div className="text-center text-xs text-gray-600">
              {data?.provider && <span>Powered by {data.provider} ({data.model})</span>}
              {rawData && (
                <span> · {rawData.articles_count} articles · {rawData.calendar_events} events</span>
              )}
              {rawData?.fear_greed && (
                <span> · Fear & Greed: {rawData.fear_greed.value} ({rawData.fear_greed.label})</span>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
