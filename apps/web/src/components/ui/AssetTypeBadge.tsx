import { clsx } from 'clsx';

export type AssetType = 'CRYPTO' | 'FOREX' | 'SYNTHETIC' | 'BRVM' | 'COMMODITY' | string;

interface AssetTypeBadgeProps {
  type: AssetType;
  className?: string;
}

const ASSET_STYLES: Record<string, string> = {
  CRYPTO: 'bg-orange-400/10 text-orange-400 border-orange-400/20',
  FOREX: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
  SYNTHETIC: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
  BRVM: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  COMMODITY: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
};

export function AssetTypeBadge({ type, className }: AssetTypeBadgeProps) {
  if (!type) return null;
  const style = ASSET_STYLES[type] ?? ASSET_STYLES.COMMODITY;

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
        style,
        className,
      )}
    >
      {type}
    </span>
  );
}
