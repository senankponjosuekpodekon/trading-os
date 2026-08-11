import { OHLCBar, ChartMarker } from './CandlestickChart';

export interface ChartPattern {
  type: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  startTime: number;
  endTime: number;
  confidence: number;
  description: string;
  levels?: { price: number; label: string }[];
}

interface Pivot {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
}

function findPivots(data: OHLCBar[], left = 3, right = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = left; i < data.length - right; i++) {
    const bar = data[i];
    let isHigh = true, isLow = true;
    for (let j = 1; j <= left; j++) {
      if (data[i - j].high >= bar.high) isHigh = false;
      if (data[i - j].low <= bar.low) isLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (data[i + j].high >= bar.high) isHigh = false;
      if (data[i + j].low <= bar.low) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, time: bar.time as number, price: bar.high, type: 'high' });
    if (isLow) pivots.push({ index: i, time: bar.time as number, price: bar.low, type: 'low' });
  }
  return pivots;
}

function priceEqual(a: number, b: number, tolerance = 0.005): boolean {
  return Math.abs(a - b) / Math.max(a, b) < tolerance;
}

export function detectChartPatterns(data: OHLCBar[]): ChartPattern[] {
  if (!data || data.length < 30) return [];
  const pivots = findPivots(data, 4, 4);
  const highs = pivots.filter(p => p.type === 'high');
  const lows = pivots.filter(p => p.type === 'low');
  const patterns: ChartPattern[] = [];

  // ── Double Top ──
  for (let i = 1; i < highs.length; i++) {
    const h1 = highs[i - 1];
    const h2 = highs[i];
    const trough = lows.filter(l => l.index > h1.index && l.index < h2.index);
    if (trough.length === 0) continue;
    const minLow = Math.min(...trough.map(t => t.price));
    const avgHigh = (h1.price + h2.price) / 2;
    if (priceEqual(h1.price, h2.price, 0.008) && minLow < avgHigh * 0.985) {
      patterns.push({
        type: 'Double Top',
        direction: 'bearish',
        startTime: h1.time,
        endTime: h2.time,
        confidence: 70,
        description: 'Double top — figure de retournement baissière. Cassure du neckline attendue.',
        levels: [
          { price: avgHigh, label: 'Resistance' },
          { price: minLow, label: 'Neckline' },
        ],
      });
    }
  }

  // ── Double Bottom ──
  for (let i = 1; i < lows.length; i++) {
    const l1 = lows[i - 1];
    const l2 = lows[i];
    const peak = highs.filter(h => h.index > l1.index && h.index < l2.index);
    if (peak.length === 0) continue;
    const maxHigh = Math.max(...peak.map(p => p.price));
    const avgLow = (l1.price + l2.price) / 2;
    if (priceEqual(l1.price, l2.price, 0.008) && maxHigh > avgLow * 1.015) {
      patterns.push({
        type: 'Double Bottom',
        direction: 'bullish',
        startTime: l1.time,
        endTime: l2.time,
        confidence: 70,
        description: 'Double bottom — figure de retournement haussière. Cassure du neckline attendue.',
        levels: [
          { price: avgLow, label: 'Support' },
          { price: maxHigh, label: 'Neckline' },
        ],
      });
    }
  }

  // ── Head and Shoulders ──
  for (let i = 2; i < highs.length; i++) {
    const ls = highs[i - 2]; // left shoulder
    const head = highs[i - 1];
    const rs = highs[i]; // right shoulder
    if (head.price <= ls.price || head.price <= rs.price) continue;
    if (priceEqual(ls.price, rs.price, 0.015)) {
      const necklineLows = lows.filter(l => l.index > ls.index && l.index < rs.index);
      if (necklineLows.length >= 2) {
        const neckline = Math.min(...necklineLows.map(l => l.price));
        patterns.push({
          type: 'Head & Shoulders',
          direction: 'bearish',
          startTime: ls.time,
          endTime: rs.time,
          confidence: 80,
          description: 'Tête et épaules — figure de retournement baissière. Cassure du neckline confirme.',
          levels: [
            { price: head.price, label: 'Head' },
            { price: neckline, label: 'Neckline' },
          ],
        });
      }
    }
  }

  // ── Inverse Head and Shoulders ──
  for (let i = 2; i < lows.length; i++) {
    const ls = lows[i - 2];
    const head = lows[i - 1];
    const rs = lows[i];
    if (head.price >= ls.price || head.price >= rs.price) continue;
    if (priceEqual(ls.price, rs.price, 0.015)) {
      const necklineHighs = highs.filter(h => h.index > ls.index && h.index < rs.index);
      if (necklineHighs.length >= 2) {
        const neckline = Math.max(...necklineHighs.map(h => h.price));
        patterns.push({
          type: 'Inverse H&S',
          direction: 'bullish',
          startTime: ls.time,
          endTime: rs.time,
          confidence: 80,
          description: 'Tête et épaules inversée — figure de retournement haussière.',
          levels: [
            { price: head.price, label: 'Head' },
            { price: neckline, label: 'Neckline' },
          ],
        });
      }
    }
  }

  // ── Ascending Triangle ──
  if (highs.length >= 3 && lows.length >= 3) {
    const recentHighs = highs.slice(-4);
    const recentLows = lows.slice(-4);
    const resistance = recentHighs[0].price;
    const flatHighs = recentHighs.filter(h => priceEqual(h.price, resistance, 0.005));
    if (flatHighs.length >= 2) {
      const ascendingLows = recentLows.every((l, i) => i === 0 || l.price > recentLows[i - 1].price);
      if (ascendingLows && recentLows.length >= 2) {
        patterns.push({
          type: 'Ascending Triangle',
          direction: 'bullish',
          startTime: recentHighs[0].time,
          endTime: recentHighs[recentHighs.length - 1].time,
          confidence: 65,
          description: 'Triangle ascendant — continuation haussière. Cassure de la résistance attendue.',
          levels: [{ price: resistance, label: 'Resistance' }],
        });
      }
    }
  }

  // ── Descending Triangle ──
  if (highs.length >= 3 && lows.length >= 3) {
    const recentHighs = highs.slice(-4);
    const recentLows = lows.slice(-4);
    const support = recentLows[0].price;
    const flatLows = recentLows.filter(l => priceEqual(l.price, support, 0.005));
    if (flatLows.length >= 2) {
      const descendingHighs = recentHighs.every((h, i) => i === 0 || h.price < recentHighs[i - 1].price);
      if (descendingHighs && recentHighs.length >= 2) {
        patterns.push({
          type: 'Descending Triangle',
          direction: 'bearish',
          startTime: recentLows[0].time,
          endTime: recentLows[recentLows.length - 1].time,
          confidence: 65,
          description: 'Triangle descendant — continuation baissière. Cassure du support attendue.',
          levels: [{ price: support, label: 'Support' }],
        });
      }
    }
  }

  // ── Rising Wedge ──
  if (highs.length >= 3 && lows.length >= 3) {
    const rh = highs.slice(-3);
    const rl = lows.slice(-3);
    const highsRising = rh.every((h, i) => i === 0 || h.price > rh[i - 1].price);
    const lowsRising = rl.every((l, i) => i === 0 || l.price > rl[i - 1].price);
    if (highsRising && lowsRising) {
      const slopeHighs = (rh[2].price - rh[0].price) / (rh[2].index - rh[0].index);
      const slopeLows = (rl[2].price - rl[0].price) / (rl[2].index - rl[0].index);
      if (slopeLows > slopeHighs * 1.3) {
        patterns.push({
          type: 'Rising Wedge',
          direction: 'bearish',
          startTime: rh[0].time,
          endTime: rh[2].time,
          confidence: 60,
          description: 'Biseau ascendant — figure de retournement baissière. Convergence des lignes.',
        });
      }
    }
  }

  // ── Falling Wedge ──
  if (highs.length >= 3 && lows.length >= 3) {
    const rh = highs.slice(-3);
    const rl = lows.slice(-3);
    const highsFalling = rh.every((h, i) => i === 0 || h.price < rh[i - 1].price);
    const lowsFalling = rl.every((l, i) => i === 0 || l.price < rl[i - 1].price);
    if (highsFalling && lowsFalling) {
      const slopeHighs = (rh[2].price - rh[0].price) / (rh[2].index - rh[0].index);
      const slopeLows = (rl[2].price - rl[0].price) / (rl[2].index - rl[0].index);
      if (Math.abs(slopeHighs) > Math.abs(slopeLows) * 1.3) {
        patterns.push({
          type: 'Falling Wedge',
          direction: 'bullish',
          startTime: rh[0].time,
          endTime: rh[2].time,
          confidence: 60,
          description: 'Biseau descendant — figure de retournement haussière. Convergence des lignes.',
        });
      }
    }
  }

  // ── Triple Top / Bottom ──
  for (let i = 2; i < highs.length; i++) {
    const h1 = highs[i - 2], h2 = highs[i - 1], h3 = highs[i];
    if (priceEqual(h1.price, h2.price, 0.006) && priceEqual(h2.price, h3.price, 0.006)) {
      patterns.push({
        type: 'Triple Top',
        direction: 'bearish',
        startTime: h1.time,
        endTime: h3.time,
        confidence: 75,
        description: 'Triple top — figure de retournement baissière forte. Trois tests de résistance échoués.',
        levels: [{ price: (h1.price + h2.price + h3.price) / 3, label: 'Resistance' }],
      });
    }
  }
  for (let i = 2; i < lows.length; i++) {
    const l1 = lows[i - 2], l2 = lows[i - 1], l3 = lows[i];
    if (priceEqual(l1.price, l2.price, 0.006) && priceEqual(l2.price, l3.price, 0.006)) {
      patterns.push({
        type: 'Triple Bottom',
        direction: 'bullish',
        startTime: l1.time,
        endTime: l3.time,
        confidence: 75,
        description: 'Triple bottom — figure de retournement haussière forte. Trois tests de support échoués.',
        levels: [{ price: (l1.price + l2.price + l3.price) / 3, label: 'Support' }],
      });
    }
  }

  // Deduplicate: keep only most recent patterns per type
  const seen = new Map<string, ChartPattern>();
  for (const p of patterns) {
    const existing = seen.get(p.type);
    if (!existing || p.endTime > existing.endTime) {
      seen.set(p.type, p);
    }
  }

  return Array.from(seen.values());
}

export function patternsToMarkers(patterns: ChartPattern[]): ChartMarker[] {
  return patterns.map(p => ({
    time: p.endTime,
    position: p.direction === 'bullish' ? 'belowBar' : 'aboveBar',
    color: p.direction === 'bullish' ? '#22d3ee' : p.direction === 'bearish' ? '#fb923c' : '#a78bfa',
    shape: p.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
    text: p.type,
  }));
}
