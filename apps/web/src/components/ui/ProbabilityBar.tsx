import { clsx } from 'clsx';

interface ProbabilityBarProps {
  value: number;
  max?: number;
  showValue?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  color?: 'emerald' | 'red' | 'amber' | 'blue' | 'purple';
}

export function ProbabilityBar({
  value,
  max = 100,
  showValue = true,
  size = 'sm',
  className,
  color,
}: ProbabilityBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const autoColor =
    value >= 70 ? 'bg-emerald-500' :
    value >= 40 ? 'bg-amber-500' :
    'bg-red-500';
  const barColor = color
    ? {
        emerald: 'bg-emerald-500',
        red: 'bg-red-500',
        amber: 'bg-amber-500',
        blue: 'bg-blue-500',
        purple: 'bg-purple-500',
      }[color]
    : autoColor;

  return (
    <div className={clsx('w-full', className)}>
      <div className="flex items-center justify-between mb-1">
        {showValue && (
          <span className={clsx('font-mono font-medium', size === 'sm' ? 'text-xs' : 'text-sm')}>
            {value.toFixed(0)}%
          </span>
        )}
      </div>
      <div
        className={clsx(
          'w-full bg-gray-800 rounded-full overflow-hidden',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
      >
        <div
          className={clsx('h-full rounded-full transition-all duration-300', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
