import { clsx } from 'clsx';

export type Regime =
  | 'TRENDING_BULL'
  | 'TRENDING_BEAR'
  | 'RANGE'
  | 'VOLATILE'
  | 'LOW_VOLATILITY'
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | string;

interface RegimeBadgeProps {
  regime?: Regime;
  className?: string;
}

const REGIME_STYLES: Record<string, string> = {
  TRENDING_BULL: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  TRENDING_BEAR: 'bg-red-400/10 text-red-400 border-red-400/20',
  RANGE: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
  VOLATILE: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  LOW_VOLATILITY: 'bg-gray-700 text-gray-300 border-gray-600',
  ACCUMULATION: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
  DISTRIBUTION: 'bg-orange-400/10 text-orange-400 border-orange-400/20',
};

export function RegimeBadge({ regime, className }: RegimeBadgeProps) {
  if (!regime || regime === '—') return null;
  const style = REGIME_STYLES[regime] ?? REGIME_STYLES.LOW_VOLATILITY;

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
        style,
        className,
      )}
    >
      {regime.replace(/_/g, ' ')}
    </span>
  );
}
