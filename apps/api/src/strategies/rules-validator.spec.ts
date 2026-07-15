import { BadRequestException } from '@nestjs/common';
import { validateStrategyRules } from './rules-validator';

describe('validateStrategyRules', () => {
  it('accepts a valid full DSL', () => {
    expect(() =>
      validateStrategyRules({
        ema_fast: 20,
        ema_slow: 50,
        ema_trend: 200,
        rsi_period: 14,
        rsi_oversold: 30,
        rsi_overbought: 70,
        min_confidence: 55,
        use_price_action: true,
        timeframes: ['1h', '4h'],
        analysis_timeframe: '4h',
        entry_timeframe: '1h',
        trigger: 'RETEST',
        markets: ['CRYPTO', 'FOREX'],
        profiles: ['SWING', 'DAY'],
        entry_rules: { bos: true, adx_min: 25, fvg_proximity_pct: 1.0 },
        filters: { regime: ['TRENDING_BULL', 'RANGING'] },
        invalidation: { ema_cross: true },
        exit_rules: { sl_atr: 1.5, tp1_atr: 2.0, tp2_atr: 3.5 },
      }),
    ).not.toThrow();
  });

  it('accepts minimal rules (all defaults)', () => {
    expect(() => validateStrategyRules({})).not.toThrow();
  });

  it('accepts legacy conditions format (seed EMA Trend + RSI)', () => {
    expect(() =>
      validateStrategyRules({
        conditions: { buy: [{ indicator: 'ema20', operator: 'gt', target: 'ema50' }] },
      }),
    ).not.toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() => validateStrategyRules({ foo_bar: 1 })).toThrow(BadRequestException);
  });

  it('rejects non-object rules', () => {
    expect(() => validateStrategyRules([] as any)).toThrow(BadRequestException);
    expect(() => validateStrategyRules(null as any)).toThrow(BadRequestException);
  });

  it('rejects out-of-bounds numeric values', () => {
    expect(() => validateStrategyRules({ rsi_oversold: 150 })).toThrow(BadRequestException);
    expect(() => validateStrategyRules({ ema_fast: 0 })).toThrow(BadRequestException);
    expect(() => validateStrategyRules({ min_confidence: -5 })).toThrow(BadRequestException);
  });

  it('rejects wrong types', () => {
    expect(() => validateStrategyRules({ use_price_action: 'yes' })).toThrow(BadRequestException);
    expect(() => validateStrategyRules({ ema_fast: '20' })).toThrow(BadRequestException);
  });

  it('rejects invalid timeframes', () => {
    expect(() => validateStrategyRules({ timeframes: ['2h'] })).toThrow(BadRequestException);
    expect(() => validateStrategyRules({ timeframes: [] })).toThrow(BadRequestException);
    expect(() => validateStrategyRules({ analysis_timeframe: '3h' })).toThrow(BadRequestException);
  });

  it('rejects invalid trigger', () => {
    expect(() => validateStrategyRules({ trigger: 'YOLO' })).toThrow(BadRequestException);
  });

  it('rejects invalid markets and profiles', () => {
    expect(() => validateStrategyRules({ markets: ['NASDAQ'] })).toThrow(BadRequestException);
    expect(() => validateStrategyRules({ profiles: ['GAMBLER'] })).toThrow(BadRequestException);
  });

  it('rejects invalid regime filters', () => {
    expect(() => validateStrategyRules({ filters: { regime: ['BULLRUN'] } })).toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid exit rules multipliers', () => {
    expect(() => validateStrategyRules({ exit_rules: { sl_atr: 0 } })).toThrow(BadRequestException);
    expect(() => validateStrategyRules({ exit_rules: { tp1_atr: 50 } })).toThrow(BadRequestException);
  });

  it('rejects incoherent cross-field values', () => {
    expect(() => validateStrategyRules({ rsi_oversold: 70, rsi_overbought: 30 })).toThrow(
      BadRequestException,
    );
    expect(() => validateStrategyRules({ ema_fast: 50, ema_slow: 20 })).toThrow(BadRequestException);
  });

  it('reports all errors at once', () => {
    try {
      validateStrategyRules({ trigger: 'YOLO', ema_fast: 0, unknown_key: 1 });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      const response = e.getResponse();
      expect(response.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
