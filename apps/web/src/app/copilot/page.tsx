'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Send, Bot, User, Loader2, Signal } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  provider?: string;
}

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Bonjour ! Je suis Trading Copilot. Posez-moi une question sur un signal, une stratégie, un trade ou la gestion du risque.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [useContext, setUseContext] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: latestSignal } = useQuery({
    queryKey: ['latest-signal'],
    queryFn: async () => (await api.get('/signals', { params: { limit: 1, sort: 'createdAt:desc' } })).data,
    staleTime: 60_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.filter(m => m.role !== 'assistant' || m.content.startsWith('[') === false).slice(-5).map(m => ({ role: m.role, content: m.content }));
      const payload: any = { message: text, history, language: 'fr' };
      const sig = latestSignal?.data?.[0];
      if (useContext && sig) {
        payload.asset = sig.asset?.symbol;
        payload.signal_context = { symbol: sig.asset?.symbol, signal: sig.signal, confidence: sig.confidence, timeframe: sig.timeframe, entry_price: sig.entryPrice, stop_loss: sig.stopLoss, take_profit_1: sig.takeProfit1, risk_reward: sig.riskReward, ...(sig.metadata as any ?? {}) };
        payload.market_context = (sig.metadata as any)?.marketContext;
      }
      const { data } = await api.post('/ai/chat', payload);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, model: data.model, provider: data.provider }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Erreur : ${e?.response?.data?.message || e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout title="Trading Copilot">
      <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex gap-3 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-violet-500/20 text-violet-400'}`}>
                  {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`rounded-xl p-4 text-sm leading-relaxed ${m.role === 'user' ? 'bg-emerald-500/10 text-emerald-50 border border-emerald-500/20' : 'bg-gray-900 text-gray-100 border border-gray-800'}`}>
                  <p>{m.content}</p>
                  {m.provider && (
                    <p className="text-[10px] text-gray-500 mt-2">{m.provider}{m.model && ` · ${m.model}`}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => setUseContext(v => !v)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${useContext ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' : 'bg-gray-900 text-gray-500 border-gray-800'}`}
            title="Inclure le contexte du dernier signal"
          >
            Contexte {useContext ? 'ON' : 'OFF'}
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ex: analyse le risque d'un BUY BTC/USDT à 65000"
            className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-4 py-3 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white rounded-xl transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
