export type SignalExecutionStatus = 'PENDING' | 'ACTIVE' | 'CLOSED_WIN' | 'CLOSED_LOSS' | 'CLOSED_BREAKEVEN' | 'EXPIRED';

interface EventLike {
  type: string;
  price: number;
  sizePct: number;
  candleTime: Date;
}

export interface DerivedOutcome {
  status: SignalExecutionStatus;
  pnlPct: number | null;
  closedAt: Date | null;
}

const BREAKEVEN_THRESHOLD_PCT = 0.05;

export function deriveSignalOutcome(entryPrice: number, direction: 'LONG' | 'SHORT', events: EventLike[]): DerivedOutcome {
  const sorted = [...events].sort((a, b) => a.candleTime.getTime() - b.candleTime.getTime());

  const entryEvent = sorted.find((e) => e.type === 'ENTRY_HIT');
  if (!entryEvent) {
    const expired = sorted.find((e) => e.type === 'EXPIRED');
    return { status: expired ? 'EXPIRED' : 'PENDING', pnlPct: null, closedAt: expired?.candleTime ?? null };
  }

  const closingEvent = sorted.find((e) => e.type === 'SL_HIT' || e.type === 'MANUAL_CLOSE');
  const partialExits = sorted.filter((e) => e.type.startsWith('TP'));

  if (!closingEvent && partialExits.length === 0) {
    return { status: 'ACTIVE', pnlPct: null, closedAt: null };
  }

  const sign = direction === 'LONG' ? 1 : -1;
  let weightedPnl = 0;
  let remainingSize = 100;

  for (const exit of partialExits) {
    const legPnl = sign * ((exit.price - entryPrice) / entryPrice) * 100;
    weightedPnl += legPnl * (exit.sizePct / 100);
    remainingSize -= exit.sizePct;
  }

  if (closingEvent) {
    const legPnl = sign * ((closingEvent.price - entryPrice) / entryPrice) * 100;
    weightedPnl += legPnl * (remainingSize / 100);
  }

  const status: SignalExecutionStatus = !closingEvent
    ? 'ACTIVE'
    : weightedPnl > BREAKEVEN_THRESHOLD_PCT
      ? 'CLOSED_WIN'
      : weightedPnl < -BREAKEVEN_THRESHOLD_PCT
        ? 'CLOSED_LOSS'
        : 'CLOSED_BREAKEVEN';

  return {
    status,
    pnlPct: closingEvent ? Math.round(weightedPnl * 100) / 100 : null,
    closedAt: closingEvent?.candleTime ?? null,
  };
}

export function computeMaxAdverseExcursion(entryPrice: number, direction: 'LONG' | 'SHORT', worstPrice: number): number {
  const sign = direction === 'LONG' ? 1 : -1;
  const raw = sign * ((worstPrice - entryPrice) / entryPrice) * 100;
  return Math.round(Math.min(0, raw) * 100) / 100;
}
