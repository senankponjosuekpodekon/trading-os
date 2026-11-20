import { liquidationPrice } from './liquidation';

describe('liquidationPrice', () => {
  it('returns null when unlevered (lev <= 1)', () => {
    expect(liquidationPrice(100, 1, 1000, 'BUY')).toBeNull();
    expect(liquidationPrice(100, 10, 1000, 'SELL')).toBeNull(); // lev = 1
  });

  it('computes BUY liquidation below entry', () => {
    // notional 500 / capital 100 = lev 5 → liqPct = 0.2 - 0.015 = 0.185
    const px = liquidationPrice(100, 5, 100, 'BUY')!;
    expect(px).toBeCloseTo(81.5, 2);
  });

  it('computes SELL liquidation above entry', () => {
    const px = liquidationPrice(100, 5, 100, 'SELL')!;
    expect(px).toBeCloseTo(118.5, 2);
  });

  it('very high leverage → already underwater (entry)', () => {
    // lev 100 → 1/100 = 0.01 < buffer → entry
    expect(liquidationPrice(100, 10, 10, 'BUY')).toBe(100);
  });

  it('guards bad inputs', () => {
    expect(liquidationPrice(0, 5, 100, 'BUY')).toBeNull();
    expect(liquidationPrice(100, 0, 100, 'BUY')).toBeNull();
    expect(liquidationPrice(100, 5, 0, 'BUY')).toBeNull();
  });
});
