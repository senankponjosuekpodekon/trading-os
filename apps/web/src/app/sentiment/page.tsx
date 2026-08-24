'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Youtube, MessageCircle, Twitter, RefreshCw, TrendingUp, TrendingDown, Minus, ThumbsUp, Eye, Newspaper, Gauge } from 'lucide-react';
import { useState } from 'react';

type Tab = 'youtube' | 'reddit' | 'x';

export default function SentimentPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('youtube');
  const [category, setCategory] = useState('crypto');

  const endpoints: Record<Tab, string> = {
    youtube: '/ai/social/youtube',
    reddit: '/ai/social/reddit',
    x: '/ai/social/x',
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sentiment', tab, category],
    queryFn: async () => {
      const res = await api.get(endpoints[tab], { params: { category } });
      return res.data;
    },
    staleTime: 1000 * 60 * 10,
  });

  const { data: fearGreed } = useQuery({
    queryKey: ['fear-greed'],
    queryFn: async () => (await api.get('/scraper/fear-greed')).data,
    staleTime: 1000 * 60 * 30,
  });

  const { data: socialAggregate } = useQuery({
    queryKey: ['social-aggregate', category],
    queryFn: async () => (await api.post('/social/sentiment/aggregate', { category })).data,
    staleTime: 1000 * 60 * 10,
  });

  const { data: news } = useQuery({
    queryKey: ['news-articles', category],
    queryFn: async () => (await api.get('/news/articles', { params: { category } })).data,
    staleTime: 1000 * 60 * 15,
  });

  const handleRefresh = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['sentiment'] });
  };

  const tabConfig: Record<Tab, { icon: React.ReactNode; label: string; color: string }> = {
    youtube: { icon: <Youtube className="w-4 h-4" />, label: 'YouTube', color: 'text-red-400' },
    reddit: { icon: <MessageCircle className="w-4 h-4" />, label: 'Reddit', color: 'text-orange-400' },
    x: { icon: <Twitter className="w-4 h-4" />, label: 'X / Twitter', color: 'text-blue-400' },
  };

  const sentimentLabel = (label: string) => {
    const cfg: Record<string, { color: string; icon: React.ReactNode }> = {
      positive: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: <TrendingUp className="w-3 h-3" /> },
      negative: { color: 'text-red-400 bg-red-500/10 border-red-500/20', icon: <TrendingDown className="w-3 h-3" /> },
      neutral: { color: 'text-gray-400 bg-gray-500/10 border-gray-500/20', icon: <Minus className="w-3 h-3" /> },
    };
    return cfg[label] || cfg.neutral;
  };

  const items = data?.videos || data?.posts || data?.tweets || [];
  const itemKey = tab === 'youtube' ? 'videos' : tab === 'reddit' ? 'posts' : 'tweets';

  return (
    <AppLayout title="Sentiment">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {tabConfig[tab].icon}
            <div>
              <h1 className="text-xl font-bold text-white">Social Sentiment</h1>
              <p className="text-sm text-gray-400">YouTube, Reddit & X/Twitter sentiment analysis</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(Object.keys(tabConfig) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition ${
                tab === t ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tabConfig[t].icon} {tabConfig[t].label}
            </button>
          ))}
        </div>

        {/* Category selector */}
        {/* Aggregate + Fear-Greed */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fearGreed && (
            <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl flex items-center gap-4">
              <Gauge className={`w-8 h-8 ${
                (fearGreed.value || 50) >= 75 ? 'text-red-400' :
                (fearGreed.value || 50) >= 55 ? 'text-yellow-400' :
                (fearGreed.value || 50) >= 45 ? 'text-gray-400' :
                'text-emerald-400'
              }`} />
              <div>
                <p className="text-xs text-gray-500">Fear & Greed</p>
                <p className="text-xl font-bold text-white">{fearGreed.value ?? '—'}</p>
                <p className="text-xs text-gray-400">{fearGreed.classification || 'neutral'}</p>
              </div>
            </div>
          )}
          {socialAggregate && (
            <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
              <p className="text-xs text-gray-500 mb-1">Social aggregate ({category})</p>
              <div className="flex items-center gap-2">
                {(() => {
                  const sc = sentimentLabel(socialAggregate.overall_label || 'neutral');
                  return <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-sm font-medium border ${sc.color}`}>{sc.icon} {socialAggregate.overall_label || 'neutral'}</span>;
                })()}
                <span className="text-sm text-gray-300">{(socialAggregate.overall_score || 0).toFixed(3)}</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">{socialAggregate.count || 0} sources analyzed</p>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {['crypto', 'forex', 'gold', 'us_stocks'].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1 text-xs rounded transition capitalize ${
                category === c ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {c.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {isLoading && <div className="text-gray-400 text-center py-12">Fetching {tab} sentiment...</div>}
        {isError && <div className="text-red-400 text-center py-12">Failed to load sentiment data</div>}

        {data && (
          <>
            {/* Overall sentiment banner */}
            <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(() => {
                    const os = data.overall_sentiment || {};
                    const sc = sentimentLabel(os.overall_label || 'neutral');
                    return (
                      <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border ${sc.color}`}>
                        {sc.icon} {os.overall_label || 'neutral'}
                      </span>
                    );
                  })()}
                  <div>
                    <p className="text-sm text-gray-300">
                      Score: {(data.overall_sentiment?.overall_score || 0).toFixed(3)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {data.overall_sentiment?.count || 0} items analyzed
                      {data.overall_sentiment?.positive_count !== undefined && (
                        ` · ${data.overall_sentiment.positive_count} positive / ${data.overall_sentiment.negative_count} negative`
                      )}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Sentiment Bonus</p>
                  <p className="text-lg font-bold text-blue-400">{data.sentiment_bonus || 0}</p>
                </div>
              </div>
            </div>

            {/* Source info */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>Source: {data.source || 'unknown'}</span>
              <span>{data[itemKey]?.length || 0} items</span>
              {data.engagement && (
                <>
                  {data.engagement.total_likes !== undefined && <span>{data.engagement.total_likes} likes</span>}
                  {data.engagement.total_comments !== undefined && <span>{data.engagement.total_comments} comments</span>}
                  {data.engagement.total_score !== undefined && <span>{data.engagement.total_score} Reddit score</span>}
                </>
              )}
            </div>

            {/* Items list */}
            <div className="space-y-3">
              {items.map((item: any, i: number) => {
                const s = item.sentiment || {};
                const sc = sentimentLabel(s.label || 'neutral');
                return (
                  <div key={i} className="p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.title || item.text?.slice(0, 120)}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          {item.channel && <span>{item.channel}</span>}
                          {item.subreddit && <span>{item.subreddit}</span>}
                          {item.author && <span>@{item.author}</span>}
                          {item.score !== undefined && <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" /> {item.score}</span>}
                          {item.stats?.views !== undefined && <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {(item.stats.views / 1000).toFixed(1)}K</span>}
                          {item.likes !== undefined && item.likes > 0 && <span>{item.likes} likes</span>}
                          {item.num_comments !== undefined && <span>{item.num_comments} comments</span>}
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border shrink-0 ${sc.color}`}>
                        {sc.icon} {s.label || 'neutral'}
                      </span>
                    </div>
                    {(item.url || item.permalink) && (
                      <a
                        href={item.url || item.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block"
                      >
                        View source →
                      </a>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && !isLoading && (
                <div className="text-center py-8 text-gray-500">No {tab} data available for {category}</div>
              )}
            </div>
          </>
        )}

        {/* News feed */}
        {news && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Newspaper className="w-4 h-4" /> News Feed
            </h3>
            <div className="space-y-3">
              {(news.articles || news || []).slice(0, 10).map((item: any, i: number) => (
                <div key={i} className="flex items-start justify-between gap-4 p-3 bg-gray-800/30 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{item.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      <span>{item.source}</span>
                      {item.published_at && <span>{new Date(item.published_at).toLocaleDateString()}</span>}
                      {item.sentiment && <span className={`${item.sentiment === 'positive' ? 'text-emerald-400' : item.sentiment === 'negative' ? 'text-red-400' : 'text-gray-400'}`}>{item.sentiment}</span>}
                    </div>
                  </div>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 shrink-0">→</a>
                  )}
                </div>
              ))}
              {(news.articles || news || []).length === 0 && <p className="text-gray-500 text-sm">No news articles available.</p>}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
