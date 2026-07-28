import { clsx } from 'clsx';

interface ConfidenceGaugeProps {
  value: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ConfidenceGauge({ value, size = 'md', className }: ConfidenceGaugeProps) {
  const pct = Math.min(100, Math.max(0, value));
  const radius = size === 'sm' ? 16 : size === 'md' ? 24 : 36;
  const stroke = size === 'sm' ? 3 : size === 'md' ? 4 : 6;
  const c = 2 * Math.PI * radius;
  const offset = c - (pct / 100) * c;

  const color = pct >= 75 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className={clsx('relative inline-flex items-center justify-center', className)}>
      <svg
        width={radius * 2 + stroke}
        height={radius * 2 + stroke}
        className="transform -rotate-90"
      >
        <circle
          cx={radius + stroke / 2}
          cy={radius + stroke / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          className="text-gray-800"
        />
        <circle
          cx={radius + stroke / 2}
          cy={radius + stroke / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          className={color}
          style={{ strokeDasharray: c, strokeDashoffset: offset, transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>
      <span
        className={clsx(
          'absolute font-mono font-semibold',
          size === 'sm' ? 'text-[8px]' : size === 'md' ? 'text-[10px]' : 'text-xs',
        )}
      >
        {Math.round(pct)}%
      </span>
    </div>
  );
}
