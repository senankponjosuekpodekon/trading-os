export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Direction = 'LONG' | 'SHORT';

export interface PriceLevels {
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfits: number[];
}

export type TouchType = 'SL' | `TP${number}`;

export interface ResolutionResult {
  order: TouchType[];
  method: 'CANDLE_CLOSE' | 'LOWER_TIMEFRAME' | 'CONSERVATIVE_SL_FIRST';
  ambiguous: boolean;
}

function isTouched(direction: Direction, level: number, candle: Candle, kind: 'SL' | 'TP'): boolean {
  if (direction === 'LONG') {
    return kind === 'SL' ? candle.low <= level : candle.high >= level;
  }
  return kind === 'SL' ? candle.high >= level : candle.low <= level;
}

export function resolveIntrabarOrder(
  direction: Direction,
  levels: PriceLevels,
  candle: Candle,
  lowerTimeframeCandles?: Candle[],
): ResolutionResult {
  const slTouched = isTouched(direction, levels.stopLoss, candle, 'SL');
  const tpTouches = levels.takeProfits.map((tp, i) => ({
    label: `TP${i + 1}` as TouchType,
    touched: isTouched(direction, tp, candle, 'TP'),
  }));
  const anyTpTouched = tpTouches.some((t) => t.touched);

  if (!slTouched && !anyTpTouched) {
    return { order: [], method: 'CANDLE_CLOSE', ambiguous: false };
  }
  if (slTouched && !anyTpTouched) {
    return { order: ['SL'], method: 'CANDLE_CLOSE', ambiguous: false };
  }
  if (!slTouched && anyTpTouched) {
    return { order: tpTouches.filter((t) => t.touched).map((t) => t.label), method: 'CANDLE_CLOSE', ambiguous: false };
  }

  if (lowerTimeframeCandles?.length) {
    const resolved = resolveViaLowerTimeframe(direction, levels, lowerTimeframeCandles);
    if (resolved) {
      return { order: resolved, method: 'LOWER_TIMEFRAME', ambiguous: true };
    }
  }

  return { order: ['SL'], method: 'CONSERVATIVE_SL_FIRST', ambiguous: true };
}

function resolveViaLowerTimeframe(direction: Direction, levels: PriceLevels, candles: Candle[]): TouchType[] | null {
  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  const order: TouchType[] = [];

  for (const c of sorted) {
    if (isTouched(direction, levels.stopLoss, c, 'SL')) {
      order.push('SL');
      return order;
    }
    levels.takeProfits.forEach((tp, i) => {
      const label = `TP${i + 1}` as TouchType;
      if (!order.includes(label) && isTouched(direction, tp, c, 'TP')) {
        order.push(label);
      }
    });
  }

  return order.length > 0 ? order : null;
}
