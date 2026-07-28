import { clsx } from 'clsx';

interface RRRatioBadgeProps {
  riskReward?: number | null;
  className?: string;
}

export function RRRatioBadge({ riskReward, className }: RRRatioBadgeProps) {
  if (riskReward === undefined || riskReward === null) return null;
  const ratio = typeof riskReward === 'number' ? riskReward : parseFloat(riskReward);
  if (Number.isNaN(ratio)) return null;

  const style =
    ratio >= 4 ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' :
    ratio >= 2 ? 'bg-blue-400/10 text-blue-400 border-blue-400/20' :
    ratio >= 1 ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20' :
    'bg-red-400/10 text-red-400 border-red-400/20';

  return (
    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', style, className)}>
      R/R 1:{ratio.toFixed(1)}
    </span>
  );
}
