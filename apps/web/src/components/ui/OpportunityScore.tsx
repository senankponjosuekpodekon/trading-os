import { Star } from 'lucide-react';
import { clsx } from 'clsx';

interface OpportunityScoreProps {
  score: number; // 0-100
  className?: string;
}

export function OpportunityScore({ score, className }: OpportunityScoreProps) {
  const normalized = Math.min(100, Math.max(0, score));
  const stars = normalized >= 80 ? 4 : normalized >= 60 ? 3 : normalized >= 40 ? 2 : normalized >= 20 ? 1 : 0;

  return (
    <div className={clsx('flex items-center gap-1.5', className)} title={`Score: ${normalized}/100`}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Star
          key={i}
          className={clsx(
            'w-3.5 h-3.5',
            i < stars ? 'text-emerald-400 fill-emerald-400' : 'text-gray-700',
          )}
        />
      ))}
      <span className="text-xs font-mono text-gray-300 ml-1">{normalized}</span>
    </div>
  );
}
