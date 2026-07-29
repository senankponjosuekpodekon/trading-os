'use client';
import { useState } from 'react';
import { Bell, User, Wifi, WifiOff, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useLivePrices } from '@/hooks/useLivePrices';
import { useNotifications } from '@/hooks/useNotifications';
import { ModeToggle } from './ModeToggle';

function PriceTicker({ symbol, price, connected }: { symbol: string; price?: number; connected: boolean }) {
  return (
    <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 rounded-lg border border-gray-700">
      <span className="text-xs text-gray-500 font-medium">{symbol}</span>
      <span className="text-sm font-mono font-semibold text-white">
        {price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
      </span>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
    </div>
  );
}

const TYPE_COLOR: Record<string, string> = {
  SIGNAL:   'text-emerald-400',
  POSITION: 'text-blue-400',
  ALERT:    'text-orange-400',
  SYSTEM:   'text-gray-400',
};

export function Topbar({ title }: { title: string }) {
  const user = useAuthStore((s) => s.user);
  const { prices, connected } = useLivePrices();
  const { notifications, unread, markAllRead } = useNotifications();
  const [showNotifs, setShowNotifs] = useState(false);

  const toggleNotifs = () => {
    setShowNotifs(v => !v);
    if (!showNotifs && unread > 0) markAllRead();
  };

  return (
    <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 relative z-50">
      <h1 className="text-lg font-semibold text-white">{title}</h1>

      <div className="flex items-center gap-3">
        {/* Prix live */}
        <PriceTicker symbol="BTC" price={prices['BTCUSDT']} connected={connected} />
        <PriceTicker symbol="ETH" price={prices['ETHUSDT']} connected={connected} />

        {/* Badge connexion */}
        <div className="flex items-center gap-1.5 text-xs" title={connected ? 'Live connecté' : 'Déconnecté'}>
          {connected
            ? <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            : <WifiOff className="w-3.5 h-3.5 text-gray-600" />}
          <span className={connected ? 'text-emerald-400' : 'text-gray-600'}>
            {connected ? 'LIVE' : 'OFF'}
          </span>
        </div>

        {/* Mode débutant / pro */}
        <ModeToggle />

        {/* Notif */}
        <div className="relative">
          <button
            onClick={toggleNotifs}
            aria-label="Notifications"
            className="relative p-2 text-gray-400 hover:text-white transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-emerald-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <span className="text-sm font-semibold text-white">Notifications</span>
                <button onClick={() => setShowNotifs(false)} aria-label="Fermer" className="text-gray-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-800">
                {notifications.length === 0 && (
                  <div className="px-4 py-8 text-center text-gray-600 text-sm">Aucune notification</div>
                )}
                {notifications.map(n => {
                  const expectedMove = n.type === 'SIGNAL' ? (n.data as any)?.expectedMove : null;
                  const mlConfidence = n.type === 'SIGNAL' ? (n.data as any)?.mlConfidence : null;
                  const mlRegime = n.type === 'SIGNAL' ? (n.data as any)?.mlRegime : null;
                  return (
                    <div key={n.id} className={`px-4 py-3 hover:bg-gray-800/50 transition-colors ${!n.read ? 'bg-gray-800/30' : ''}`}>
                      <div className="flex items-start gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${!n.read ? 'bg-emerald-400' : 'bg-gray-700'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold ${TYPE_COLOR[n.type] ?? 'text-gray-300'}`}>{n.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                          {(expectedMove && (expectedMove.move_pct != null || expectedMove.volatility_regime)) || mlConfidence != null || mlRegime ? (
                            <div className="mt-1 text-[11px] text-gray-400 flex flex-wrap gap-2">
                              {expectedMove.move_pct != null && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-200 font-mono">
                                  ±{expectedMove.move_pct.toFixed(2)}%
                                  {expectedMove.horizon ? <span className="text-gray-500">/{expectedMove.horizon} barres</span> : null}
                                </span>
                              )}
                              {expectedMove.volatility_regime && (
                                <span className="px-2 py-0.5 rounded-full border border-gray-700 bg-gray-900 text-gray-300">
                                  {expectedMove.volatility_regime} vol
                                </span>
                              )}
                              {mlConfidence != null && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-200 font-mono">
                                  ML {mlConfidence.toFixed(1)}%
                                </span>
                              )}
                              {mlRegime && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-sky-400/30 bg-sky-500/10 text-sky-200 font-mono">
                                  Regime {mlRegime}
                                </span>
                              )}
                            </div>
                          ) : null}
                          <p className="text-xs text-gray-700 mt-1">{new Date(n.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* User */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-sm">
            <p className="text-white font-medium leading-none">{user?.name ?? '...'}</p>
            <p className="text-gray-500 text-xs mt-0.5">{user?.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
