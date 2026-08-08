import { AlertTriangle, Shield, ShieldCheck, ShieldAlert } from 'lucide-react';

type RiskLevel = 'EXTREME' | 'HIGH' | 'MODERATE' | 'LOW';

const RISK_STYLES: Record<RiskLevel, { bg: string; text: string; border: string; icon: typeof Shield }> = {
  EXTREME:  { bg: 'bg-red-500/10',    text: 'text-red-500',    border: 'border-red-500/30',    icon: AlertTriangle },
  HIGH:     { bg: 'bg-orange-500/10',  text: 'text-orange-500',  border: 'border-orange-500/30',  icon: ShieldAlert },
  MODERATE: { bg: 'bg-yellow-500/10',  text: 'text-yellow-500',  border: 'border-yellow-500/30',  icon: Shield },
  LOW:      { bg: 'bg-green-500/10',   text: 'text-green-500',   border: 'border-green-500/30',   icon: ShieldCheck },
};

interface RiskLevelBadgeProps {
  level: RiskLevel | string | null | undefined;
  reasons?: string[] | null;
  className?: string;
}

export function RiskLevelBadge({ level, reasons, className }: RiskLevelBadgeProps) {
  if (!level) return null;
  const upper = (level as string).toUpperCase() as RiskLevel;
  const style = RISK_STYLES[upper] ?? RISK_STYLES.MODERATE;
  const Icon = style.icon;
  const tooltip = reasons?.length ? reasons.join(', ') : `${upper} risk`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${style.bg} ${style.text} ${style.border} ${className ?? ''}`}
      title={tooltip}
    >
      <Icon className="w-3 h-3" />
      {upper}
    </span>
  );
}
