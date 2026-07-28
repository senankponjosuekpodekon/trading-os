import { clsx } from 'clsx';

interface LiveDotProps {
  live?: boolean;
  label?: string;
  className?: string;
}

export function LiveDot({ live = true, label, className }: LiveDotProps) {
  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      <span
        className={clsx(
          'w-2 h-2 rounded-full',
          live ? 'bg-emerald-400 animate-pulse' : 'bg-red-400',
        )}
      />
      <span className={clsx('text-xs font-medium', live ? 'text-emerald-400' : 'text-red-400')}>
        {label ?? (live ? 'LIVE' : 'OFFLINE')}
      </span>
    </div>
  );
}
