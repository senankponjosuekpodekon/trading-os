'use client';
import { useModeStore } from '@/store/mode.store';
import { clsx } from 'clsx';

export function ModeToggle() {
  const { mode, toggle } = useModeStore();
  const isPro = mode === 'professional';

  return (
    <button
      onClick={toggle}
      aria-label={isPro ? 'Passer en mode débutant' : 'Passer en mode professionnel'}
      className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs font-medium transition-colors hover:border-gray-700"
    >
      <span className={clsx('transition-colors', isPro ? 'text-gray-500' : 'text-emerald-400')}>Débutant</span>
      <span
        className={clsx(
          'relative w-8 h-4 rounded-full transition-colors',
          isPro ? 'bg-emerald-500/20' : 'bg-gray-700',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-emerald-400 transition-transform',
            isPro ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
      <span className={clsx('transition-colors', isPro ? 'text-emerald-400' : 'text-gray-500')}>Pro</span>
    </button>
  );
}
