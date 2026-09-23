'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, FileText, RefreshCw, Zap, MessageSquare, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface AiHealth {
  openai_configured: boolean;
  model:    string;
  status:   string;
  provider: string;
  ollama_url: string | null;
}

interface RagDoc {
  id: number;
  title: string;
  category: string;
  created_at: string;
}

export default function AiPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'report' | 'explain' | 'knowledge'>('report');
  const [report, setReport]       = useState<string | null>(null);
  const [explain, setExplain]     = useState<string | null>(null);
  const [customSignal, setCustomSignal] = useState({
    symbol: 'BTC/USDT', timeframe: '1h', signal: 'BUY',
    confidence: 75, explanation: '',
  });
  const [newDoc, setNewDoc] = useState({
    title: '', category: 'general', content: '', metadata: '',
  });

  const { data: health } = useQuery<AiHealth>({
    queryKey: ['ai-health'],
    queryFn:  async () => (await api.get('/ai/health')).data,
  });

  const { data: summary } = useQuery({
    queryKey: ['positions-summary'],
    queryFn:  async () => (await api.get('/positions/summary')).data,
  });

  const genReport = useMutation({
    mutationFn: async () => {
      const positions = summary?.positions ?? [];
      const closed = positions.filter((p: any) => p.status === 'CLOSED');
      const wins   = closed.filter((p: any) => parseFloat(p.pnl ?? 0) > 0);
      const trades = closed.map((p: any) => {
        const entry = parseFloat(p.entryPrice ?? 0);
        const qty   = parseFloat(p.quantity ?? 0);
        const sl    = p.stopLoss   ? parseFloat(p.stopLoss)   : null;
        const tp    = p.takeProfit ? parseFloat(p.takeProfit) : null;
        const cost  = parseFloat((entry * qty).toFixed(2));
        const pnl   = parseFloat(p.pnl ?? 0);
        const pnlPct = parseFloat(p.pnlPercent ?? 0);
        return {
          symbol:      p.asset?.symbol,
          direction:   p.direction,
          entry_price: entry,
          exit_price:  p.exitPrice ? parseFloat(p.exitPrice) : null,
          quantity:    qty,
          cost,
          stop_loss:   sl,
          take_profit: tp,
          pnl,
          pnl_pct:     pnlPct,
          max_gain:    tp   ? parseFloat((Math.abs(tp - entry) * qty).toFixed(2)) : null,
          max_loss:    sl   ? parseFloat((Math.abs(entry - sl) * qty).toFixed(2)) : null,
          opened_at:   p.openedAt,
          closed_at:   p.closedAt,
        };
      });
      const best  = trades.length ? trades.reduce((a: any, b: any) => a.pnl > b.pnl ? a : b) : null;
      const worst = trades.length ? trades.reduce((a: any, b: any) => a.pnl < b.pnl ? a : b) : null;
      const totalCost = trades.reduce((s: number, t: any) => s + t.cost, 0);
      const capitalInfo = summary?.capital ?? null;

      const { data } = await api.post('/ai/weekly-report', {
        trades,
        win_rate:    closed.length ? (wins.length / closed.length) * 100 : 0,
        total_pnl:   trades.reduce((s: number, t: any) => s + t.pnl, 0),
        total_cost:  totalCost,
        capital:     capitalInfo,
        best_trade:  best,
        worst_trade: worst,
        language:    'fr',
      });
      return data;
    },
    onSuccess: (data) => setReport(data.report),
  });

  const genExplain = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/ai/explain', {
        ...customSignal,
        indicators: { close: 0, ema20: 0, ema50: 0, rsi: 55, macd_hist: 0.5 },
        language: 'fr',
      });
      return data;
    },
    onSuccess: (data) => setExplain(data.ai_explanation),
  });

  const addDoc = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/rag/documents', {
        title: newDoc.title,
        category: newDoc.category,
        content: newDoc.content,
        metadata: newDoc.metadata ? JSON.parse(newDoc.metadata) : {},
      });
      return data;
    },
    onSuccess: () => {
      setNewDoc({ title: '', category: 'general', content: '', metadata: '' });
      qc.invalidateQueries({ queryKey: ['rag-documents'] });
    },
  });

  const { data: docsList, isLoading: docsLoading } = useQuery<{ documents: RagDoc[]; count: number }>({
    queryKey: ['rag-documents'],
    queryFn: async () => {
      const { data } = await api.get('/rag/documents', { params: { limit: 100 } });
      return data;
    },
    enabled: activeTab === 'knowledge',
  });

  const CATEGORIES = ['indicateurs', 'smc', 'risk', 'brvm', 'deriv', 'trading', 'general'];
  const CAT_LABELS: Record<string, string> = {
    indicateurs: 'Indicateurs', smc: 'SMC', risk: 'Risk',
    brvm: 'BRVM', deriv: 'Deriv', trading: 'Trading', general: 'Général',
  };

  return (
    <>
      <div className="space-y-5">

        {/* Status LLM */}
        <div className={`flex items-center gap-3 p-3.5 rounded-xl border text-sm ${
          health?.status === 'ready'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
        }`}>
          <Brain className="w-4 h-4 shrink-0" />
          <span className="font-semibold flex-1">
            {health?.status === 'ready'
              ? `${health.provider === 'ollama' ? '🦙 Ollama' : '☁️ ' + health.provider} — ${health.model}`
              : 'Mode démo — aucun LLM configuré (RAG fonctionne, génération désactivée)'}
          </span>
          <Link href="/copilot"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white transition-colors">
            <MessageSquare className="w-3.5 h-3.5" /> Ouvrir le Copilot
          </Link>
        </div>

        {/* Onglets */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {([
            { id: 'report',   icon: FileText, label: 'Rapport hebdo' },
            { id: 'explain',  icon: Zap,      label: 'Expliquer un signal' },
            { id: 'knowledge', icon: BookOpen, label: 'Base de connaissances' },
          ] as const).map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 flex-1 justify-center py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === id
                  ? 'bg-violet-500 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {/* ── TAB RAPPORT ──────────────────────────────────────────── */}
        {activeTab === 'report' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4 text-violet-400" />
              <h2 className="text-white font-semibold">Rapport hebdomadaire</h2>
            </div>
            {summary && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Trades clôturés', value: summary.closed ?? 0 },
                  { label: 'Win Rate', value: `${(summary.winRate ?? 0).toFixed(1)}%` },
                  { label: 'PnL total', value: `$${(summary.totalPnl ?? 0).toFixed(2)}` },
                ].map(s => (
                  <div key={s.label} className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500 mb-0.5">{s.label}</p>
                    <p className="text-white font-bold text-sm">{s.value}</p>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => genReport.mutate()} disabled={genReport.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors w-full justify-center">
              {genReport.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" />Génération…</>
                : <><Brain className="w-4 h-4" />Générer le rapport</>}
            </button>
            {report && (
              <div className="mt-4 p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">{report}</p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB KNOWLEDGE ────────────────────────────────────────── */}
        {activeTab === 'knowledge' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen className="w-4 h-4 text-violet-400" />
              <h2 className="text-white font-semibold">Enrichir la base RAG</h2>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              Ajoute un document à la base de connaissances — le Copilot le cite dans ses réponses. L'embedding est calculé automatiquement.
            </p>
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Titre *</label>
                  <input value={newDoc.title}
                    onChange={e => setNewDoc(v => ({ ...v, title: e.target.value }))}
                    placeholder="ex: Stratégie Wyckoff"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Catégorie</label>
                  <select value={newDoc.category}
                    onChange={e => setNewDoc(v => ({ ...v, category: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500">
                    {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Contenu *</label>
                <textarea rows={6}
                  value={newDoc.content}
                  onChange={e => setNewDoc(v => ({ ...v, content: e.target.value }))}
                  placeholder="Colle ici le contenu pédagogique..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500 resize-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Métadonnées (JSON optionnel)</label>
                <input value={newDoc.metadata}
                  onChange={e => setNewDoc(v => ({ ...v, metadata: e.target.value }))}
                  placeholder='{"source": "article"}'
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500" />
              </div>
            </div>
            {addDoc.isError && (
              <div className="text-red-400 text-sm mb-3">{addDoc.error instanceof Error ? addDoc.error.message : 'Erreur'}</div>
            )}
            {addDoc.isSuccess && (
              <div className="text-emerald-400 text-sm mb-3">Document ajouté à la base RAG.</div>
            )}
            <button onClick={() => addDoc.mutate()} disabled={addDoc.isPending || !newDoc.title.trim() || !newDoc.content.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors w-full justify-center">
              {addDoc.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" />Indexation…</>
                : <><BookOpen className="w-4 h-4" />Ajouter à la base</>}
            </button>

            <div className="mt-6 border-t border-gray-800 pt-4">
              <h3 className="text-white font-semibold text-sm mb-2 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-violet-400" />
                Documents indexés ({docsList?.count ?? 0})
              </h3>
              {docsLoading ? (
                <div className="text-gray-500 text-sm">Chargement…</div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {docsList?.documents?.map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-2.5 bg-gray-800 border border-gray-700 rounded-lg">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{d.title}</p>
                        <p className="text-xs text-gray-500">
                          <span className="text-violet-400">{d.category}</span>
                          <span className="mx-1">·</span>
                          {new Date(d.created_at).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                      <span className="text-xs text-gray-600 font-mono">#{d.id}</span>
                    </div>
                  ))}
                  {!docsList?.documents?.length && (
                    <div className="text-gray-500 text-sm">Aucun document dans la base.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB SIGNAL ───────────────────────────────────────────── */}
        {activeTab === 'explain' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-emerald-400" />
              <h2 className="text-white font-semibold">Expliquer un signal</h2>
            </div>
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Actif</label>
                  <select value={customSignal.symbol}
                    onChange={e => setCustomSignal(v => ({ ...v, symbol: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500">
                    {['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Direction</label>
                  <select value={customSignal.signal}
                    onChange={e => setCustomSignal(v => ({ ...v, signal: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500">
                    <option>BUY</option><option>SELL</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Confiance %</label>
                  <input type="number" min={0} max={100} value={customSignal.confidence}
                    onChange={e => setCustomSignal(v => ({ ...v, confidence: parseInt(e.target.value) }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Contexte / raisons</label>
                <textarea rows={2} placeholder="ex: EMA bullish alignment | MACD crossover | BOS bullish"
                  value={customSignal.explanation}
                  onChange={e => setCustomSignal(v => ({ ...v, explanation: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-violet-500 resize-none" />
              </div>
            </div>
            <button onClick={() => genExplain.mutate()} disabled={genExplain.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors w-full justify-center">
              {genExplain.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" />Analyse…</>
                : <><Brain className="w-4 h-4" />Expliquer avec le LLM</>}
            </button>
            {explain && (
              <div className="mt-4 p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                <p className="text-gray-300 text-sm leading-relaxed">{explain}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
