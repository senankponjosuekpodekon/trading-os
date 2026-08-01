'use client';
import { createContext, useCallback, useEffect, useState } from 'react';
import { X, AlertCircle, Bell, CheckCircle2, Info } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  title?: string;
  message: string;
  type: ToastType;
}

export interface ToastContextValue {
  toast: (message: string, opts?: { title?: string; type?: ToastType }) => void;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_STYLES: Record<ToastType, { icon: React.ReactNode; border: string; text: string }> = {
  info:    { icon: <Info className="w-4 h-4 text-blue-400" />, border: 'border-blue-500/30', text: 'text-blue-400' },
  success: { icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />, border: 'border-emerald-500/30', text: 'text-emerald-400' },
  warning: { icon: <AlertCircle className="w-4 h-4 text-orange-400" />, border: 'border-orange-500/30', text: 'text-orange-400' },
  error:   { icon: <X className="w-4 h-4 text-red-400" />, border: 'border-red-500/30', text: 'text-red-400' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, opts?: { title?: string; type?: ToastType }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const type = opts?.type ?? 'info';
    setToasts(prev => [{ id, title: opts?.title, message, type }, ...prev].slice(0, 5));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map(t =>
      setTimeout(() => dismiss(t.id), 4500),
    );
    return () => { timers.forEach(clearTimeout); };
  }, [toasts, dismiss]);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" role="alert" aria-live="polite">
        {toasts.map(t => {
          const style = TYPE_STYLES[t.type];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto w-80 bg-gray-900 border ${style.border} rounded-xl shadow-2xl p-3 flex items-start gap-3 animate-in slide-in-from-right`}
              role="status"
            >
              {style.icon}
              <div className="flex-1 min-w-0">
                {t.title && <p className={`text-xs font-semibold ${style.text}`}>{t.title}</p>}
                <p className="text-sm text-gray-300 leading-snug">{t.message}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="text-gray-500 hover:text-white"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
