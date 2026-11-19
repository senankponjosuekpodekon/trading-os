import { Mt5SizingError, unitsToLots, validateStops, riskToStop, marginRequired, Mt5Contract } from './mt5-sizing';

const EURUSD: Mt5Contract = {
  contract_size: 100000, volume_min: 0.01, volume_max: 50, volume_step: 0.01,
  point: 0.00001, digits: 5, stops_level: 20, tick_value: 1, tick_size: 0.00001,
};

describe('unitsToLots', () => {
  it('converts base units to lots via the real contract size', () => {
    expect(unitsToLots(10000, EURUSD)).toBe(0.1);
    expect(unitsToLots(100000, EURUSD)).toBe(1);
  });

  it('rounds down to the volume step — never increases risk', () => {
    // 10999 unités = 0.10999 lot → 0.10, pas 0.11
    expect(unitsToLots(10999, EURUSD)).toBe(0.1);
  });

  it('handles non-forex contract sizes (XAG = 5000 oz/lot)', () => {
    const XAG: Mt5Contract = { ...EURUSD, contract_size: 5000 };
    expect(unitsToLots(5000, XAG)).toBe(1);
    expect(unitsToLots(500, XAG)).toBe(0.1);
  });

  it('rejects quantities below the broker minimum instead of clamping up', () => {
    expect(() => unitsToLots(500, EURUSD)).toThrow(Mt5SizingError);
    expect(() => unitsToLots(500, EURUSD)).toThrow(/minimum broker/);
  });

  it('rejects volumes above the broker maximum', () => {
    expect(() => unitsToLots(100000 * 51, EURUSD)).toThrow(/maximum broker/);
  });

  it('rejects invalid quantities and malformed contracts', () => {
    expect(() => unitsToLots(0, EURUSD)).toThrow(Mt5SizingError);
    expect(() => unitsToLots(-5, EURUSD)).toThrow(Mt5SizingError);
    expect(() => unitsToLots(NaN, EURUSD)).toThrow(Mt5SizingError);
    expect(() => unitsToLots(10000, { ...EURUSD, contract_size: 0 })).toThrow(/contract_size/);
    expect(() => unitsToLots(10000, { ...EURUSD, volume_step: 0 })).toThrow(/volume_step/);
  });
});

describe('validateStops', () => {
  it('accepts stops beyond the broker stops_level', () => {
    // stops_level 20 pts × point 1e-5 → distance min 0.0002
    expect(() => validateStops('BUY', 1.08, 1.079, undefined, EURUSD)).not.toThrow();
  });

  it('rejects stops closer than stops_level', () => {
    expect(() => validateStops('BUY', 1.08, 1.0799, undefined, EURUSD)).toThrow(/trop proche/);
  });

  it('rejects stops on the wrong side', () => {
    expect(() => validateStops('BUY', 1.08, 1.09, undefined, EURUSD)).toThrow(/mauvais côté/);
    expect(() => validateStops('SELL', 1.08, 1.07, undefined, EURUSD)).toThrow(/mauvais côté/);
  });

  it('validates take profit symmetrically', () => {
    expect(() => validateStops('BUY', 1.08, undefined, 1.081, EURUSD)).not.toThrow();
    expect(() => validateStops('BUY', 1.08, undefined, 1.07, EURUSD)).toThrow(/mauvais côté/);
    expect(() => validateStops('BUY', 1.08, undefined, 1.0801, EURUSD)).toThrow(/trop proche/);
  });

  it('rejects non-finite or non-positive levels', () => {
    expect(() => validateStops('BUY', 1.08, NaN, undefined, EURUSD)).toThrow(Mt5SizingError);
    expect(() => validateStops('BUY', 1.08, -1, undefined, EURUSD)).toThrow(Mt5SizingError);
  });
});

describe('riskToStop / marginRequired', () => {
  it('computes cash risk from tick value and size', () => {
    // 0.1 lot, distance 0.001 = 100 ticks × $1/tick/lot × 0.1 = $10
    expect(riskToStop(0.1, 1.08, 1.079, EURUSD)).toBe(10);
  });

  it('returns null without sl or tick data', () => {
    expect(riskToStop(0.1, 1.08, undefined, EURUSD)).toBeNull();
    expect(riskToStop(0.1, 1.08, 1.079, { ...EURUSD, tick_value: undefined })).toBeNull();
  });

  it('estimates margin only when the broker publishes a fixed margin', () => {
    expect(marginRequired(2, { ...EURUSD, margin_initial: 100 })).toBe(200);
    expect(marginRequired(2, EURUSD)).toBeNull();
  });
});
