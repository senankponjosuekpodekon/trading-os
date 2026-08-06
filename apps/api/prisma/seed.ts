import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const markets = [
    { name: 'Crypto', type: 'CRYPTO' as const },
    { name: 'Forex', type: 'FOREX' as const },
    { name: 'Indices', type: 'INDICES' as const },
    { name: 'Commodities', type: 'COMMODITIES' as const },
    { name: 'Synthetic', type: 'SYNTHETIC' as const },
    { name: 'BRVM', type: 'STOCKS' as const },
  ];

  for (const m of markets) {
    await prisma.market.upsert({
      where: { name: m.name },
      update: {},
      create: m,
    });
  }

  const crypto = await prisma.market.findUnique({ where: { name: 'Crypto' } });
  const forex  = await prisma.market.findUnique({ where: { name: 'Forex' } });
  const synth  = await prisma.market.findUnique({ where: { name: 'Synthetic' } });
  const commo  = await prisma.market.findUnique({ where: { name: 'Commodities' } });
  const brvm   = await prisma.market.findUnique({ where: { name: 'BRVM' } });

  const assets = [
    { symbol: 'BTC/USDT',  name: 'Bitcoin',           marketId: crypto!.id, baseCurrency: 'USDT' },
    { symbol: 'ETH/USDT',  name: 'Ethereum',           marketId: crypto!.id, baseCurrency: 'USDT' },
    { symbol: 'SOL/USDT',  name: 'Solana',             marketId: crypto!.id, baseCurrency: 'USDT' },
    { symbol: 'BNB/USDT',  name: 'BNB',                marketId: crypto!.id, baseCurrency: 'USDT' },
    { symbol: 'EUR/USD',   name: 'Euro / US Dollar',   marketId: forex!.id,  baseCurrency: 'USD' },
    { symbol: 'GBP/USD',   name: 'Pound / US Dollar',  marketId: forex!.id,  baseCurrency: 'USD' },
    { symbol: 'USD/JPY',   name: 'Dollar / Yen',       marketId: forex!.id,  baseCurrency: 'JPY' },
    { symbol: 'XAU/USD',   name: 'Gold',               marketId: commo!.id,  baseCurrency: 'USD' },
    { symbol: 'XAG/USD',   name: 'Silver',             marketId: commo!.id,  baseCurrency: 'USD' },
    { symbol: 'V75',       name: 'Volatility 75 Index',marketId: synth!.id,  baseCurrency: 'USD' },
    { symbol: 'V100',      name: 'Volatility 100 Index',marketId: synth!.id, baseCurrency: 'USD' },
    { symbol: 'BOOM1000',  name: 'Boom 1000 Index',    marketId: synth!.id,  baseCurrency: 'USD' },
    { symbol: 'CRASH1000', name: 'Crash 1000 Index',   marketId: synth!.id,  baseCurrency: 'USD' },
    { symbol: 'ONTBF', name: 'ONATEL Burkina Faso', marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'SGBF',  name: 'Société Générale BF', marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'BOABF', name: 'Bank of Africa BF',   marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'ETIT',  name: 'Ecobank Transnational', marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'SIVC',  name: 'SICOGI',              marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'PALC',  name: 'Palm CI',             marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'SOGC',  name: 'SOGB',                marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'SNTS',  name: 'Sonatel',             marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'CIEC',  name: 'CIE',                 marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'NSIC',  name: 'NSIA Banque CI',      marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'ORGT',  name: 'Orange CI',           marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'BICC',  name: 'BICI CI',             marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'CBIBF', name: 'Coris Bank',          marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'ABJC',  name: 'Abidjan.net',         marketId: brvm!.id, baseCurrency: 'XOF' },
    { symbol: 'STAC',  name: 'SOLIBRA',             marketId: brvm!.id, baseCurrency: 'XOF' },
  ];

  for (const a of assets) {
    await prisma.asset.upsert({
      where: { symbol: a.symbol },
      update: {},
      create: a,
    });
  }

  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { role: 'SUPER_ADMIN' },
    create: {
      email: 'admin@example.com',
      password: adminPassword,
      name: 'Super Admin',
      role: 'SUPER_ADMIN' as any,
      isActive: true,
    },
  });

  await prisma.portfolio.upsert({
    where: { id: 'default-admin-portfolio' },
    update: {},
    create: {
      name: 'Mon Portfolio',
      type: 'PAPER',
      userId: admin.id,
    },
  });

  // Règles au format DSL parsé par apps/engine/routers/strategy_eval.py (StrategyRules)
  const emaTrendRsiRules = {
    ema_fast: 20,
    ema_slow: 50,
    ema_trend: 200,
    rsi_period: 14,
    rsi_oversold: 30,
    rsi_overbought: 70,
    rsi_bullish_zone: 45,
    rsi_bearish_zone: 55,
    min_confidence: 55,
    volume_spike_min: 1.3,
    atr_min_pct: 0.2,
    use_price_action: true,
    use_sr_zones: true,
    use_patterns: true,
    timeframes: ['1h', '4h'],
    trigger: 'BREAKOUT',
    profiles: ['SWING', 'DAY'],
    markets: ['CRYPTO', 'FOREX', 'INDICES'],
  };

  const strategy = await prisma.strategy.upsert({
    where: { name: 'EMA Trend + RSI' },
    update: { rules: emaTrendRsiRules, analysisTimeframe: '4h', entryTimeframe: '1h', isActive: true },
    create: {
      name: 'EMA Trend + RSI',
      description: 'Tendance EMA 20/50/200 avec confirmation RSI. Analyse sur 4h, entrée sur 1h.',
      rules: emaTrendRsiRules,
      analysisTimeframe: '4h',
      entryTimeframe: '1h',
      isActive: true,
    },
  });

  // ── Stratégie 2 : MACD Momentum ──────────────────────────────
  const macdMomentumRules = {
    ema_fast: 12,
    ema_slow: 26,
    ema_trend: 200,
    rsi_period: 14,
    rsi_oversold: 35,
    rsi_overbought: 65,
    rsi_bullish_zone: 50,
    rsi_bearish_zone: 50,
    min_confidence: 60,
    min_dps: 55,
    volume_spike_min: 1.5,
    use_price_action: true,
    use_sr_zones: false,
    use_patterns: false,
    atr_min_pct: 0.3,
    timeframes: ['15m', '1h'],
    trigger: 'MOMENTUM_CONFIRMATION',
    profiles: ['DAY', 'SCALPER'],
    markets: ['CRYPTO', 'FOREX'],
    entry_rules: { ema_fast_above_slow: true },
    filters: { regime: ['TRENDING_BULL', 'TRENDING_BEAR'] },
  };

  const macdMomentum = await prisma.strategy.upsert({
    where: { name: 'MACD Momentum' },
    update: { rules: macdMomentumRules, analysisTimeframe: '1h', entryTimeframe: '15m', isActive: true },
    create: {
      name: 'MACD Momentum',
      description: 'Entrée sur momentum MACD confirmé par volume. EMA 12/26 pour direction, analyse 1h, entrée 15m.',
      rules: macdMomentumRules,
      analysisTimeframe: '1h',
      entryTimeframe: '15m',
      isActive: true,
    },
  });

  // ── Stratégie 3 : Bollinger Squeeze Breakout ────────────────
  const bbSqueezeRules = {
    ema_fast: 20,
    ema_slow: 50,
    ema_trend: 200,
    rsi_period: 14,
    rsi_oversold: 25,
    rsi_overbought: 75,
    rsi_bullish_zone: 50,
    rsi_bearish_zone: 50,
    min_confidence: 55,
    min_dps: 50,
    volume_spike_min: 1.8,
    use_price_action: true,
    use_sr_zones: true,
    use_patterns: false,
    atr_min_pct: 0.4,
    timeframes: ['1h', '4h'],
    trigger: 'VOLATILITY_EXPANSION',
    profiles: ['SWING', 'DAY'],
    markets: ['CRYPTO', 'INDICES', 'COMMODITIES', 'SYNTHETIC'],
    entry_rules: { bb_bw_min: 0.02 },
    filters: { regime: ['VOLATILE', 'TRENDING_BULL', 'TRENDING_BEAR'] },
  };

  const bbSqueeze = await prisma.strategy.upsert({
    where: { name: 'Bollinger Squeeze Breakout' },
    update: { rules: bbSqueezeRules, analysisTimeframe: '4h', entryTimeframe: '1h', isActive: true },
    create: {
      name: 'Bollinger Squeeze Breakout',
      description: 'Breakout de compression Bollinger Bands avec expansion de volatilité. Analyse 4h, entrée 1h.',
      rules: bbSqueezeRules,
      analysisTimeframe: '4h',
      entryTimeframe: '1h',
      isActive: true,
    },
  });

  // ── Stratégie 4 : SMC Retest OB/FVG ─────────────────────────
  const smcRetestRules = {
    ema_fast: 20,
    ema_slow: 50,
    ema_trend: 200,
    rsi_period: 14,
    rsi_oversold: 30,
    rsi_overbought: 70,
    rsi_bullish_zone: 45,
    rsi_bearish_zone: 55,
    min_confidence: 60,
    min_dps: 60,
    volume_spike_min: 1.2,
    use_price_action: true,
    use_sr_zones: true,
    use_smc: true,
    use_patterns: true,
    atr_min_pct: 0.25,
    timeframes: ['1h', '4h'],
    trigger: 'RETEST',
    profiles: ['SWING', 'INVESTOR'],
    markets: ['CRYPTO', 'FOREX', 'INDICES', 'SYNTHETIC'],
    entry_rules: { fvg_proximity_pct: 1.5, bos: true },
    filters: { regime: ['TRENDING_BULL', 'TRENDING_BEAR'] },
    exit_rules: { sl_atr: 1.2, tp1_atr: 2.5, tp2_atr: 4.0 },
  };

  const smcRetest = await prisma.strategy.upsert({
    where: { name: 'SMC Retest OB/FVG' },
    update: { rules: smcRetestRules, analysisTimeframe: '4h', entryTimeframe: '1h', isActive: true },
    create: {
      name: 'SMC Retest OB/FVG',
      description: 'Smart Money Concepts : retest Order Block / FVG après BOS. Analyse 4h, entrée 1h sur retest.',
      rules: smcRetestRules,
      analysisTimeframe: '4h',
      entryTimeframe: '1h',
      isActive: true,
    },
  });

  // ── Stratégie 5 : Scalper RSI Reversal ──────────────────────
  const scalperRsiRules = {
    ema_fast: 9,
    ema_slow: 21,
    ema_trend: 50,
    rsi_period: 7,
    rsi_oversold: 20,
    rsi_overbought: 80,
    rsi_bullish_zone: 50,
    rsi_bearish_zone: 50,
    min_confidence: 65,
    min_dps: 65,
    volume_spike_min: 2.0,
    use_price_action: true,
    use_sr_zones: true,
    use_patterns: true,
    atr_min_pct: 0.15,
    timeframes: ['5m', '15m'],
    trigger: 'MOMENTUM_CONFIRMATION',
    profiles: ['SCALPER'],
    markets: ['FOREX'],
    filters: { regime: ['RANGING'] },
    exit_rules: { sl_atr: 1.0, tp1_atr: 1.0, tp2_atr: 1.5 },
  };

  const scalperRsi = await prisma.strategy.upsert({
    where: { name: 'Scalper RSI Reversal' },
    update: { rules: scalperRsiRules, analysisTimeframe: '15m', entryTimeframe: '5m', isActive: true },
    create: {
      name: 'Scalper RSI Reversal',
      description: 'Scalping RSI 7 extrêmes (20/80) avec momentum volume. Analyse 15m, entrée 5m. Régime ranging.',
      rules: scalperRsiRules,
      analysisTimeframe: '15m',
      entryTimeframe: '5m',
      isActive: true,
    },
  });

  // ── Stratégie 6 : Swing Trend Follow ────────────────────────
  const swingTrendRules = {
    ema_fast: 50,
    ema_slow: 100,
    ema_trend: 200,
    rsi_period: 14,
    rsi_oversold: 40,
    rsi_overbought: 60,
    rsi_bullish_zone: 50,
    rsi_bearish_zone: 50,
    min_confidence: 55,
    min_dps: 55,
    volume_spike_min: 1.0,
    use_price_action: true,
    use_sr_zones: true,
    use_patterns: true,
    atr_min_pct: 0.3,
    timeframes: ['4h', '1d'],
    trigger: 'BREAKOUT',
    profiles: ['INVESTOR', 'SWING'],
    markets: ['CRYPTO', 'FOREX', 'INDICES', 'COMMODITIES', 'SYNTHETIC'],
    entry_rules: { adx_min: 25 },
    filters: { regime: ['TRENDING_BULL', 'TRENDING_BEAR'] },
    exit_rules: { sl_atr: 2.0, tp1_atr: 3.0, tp2_atr: 6.0 },
  };

  const swingTrend = await prisma.strategy.upsert({
    where: { name: 'Swing Trend Follow' },
    update: { rules: swingTrendRules, analysisTimeframe: '1d', entryTimeframe: '4h', isActive: true },
    create: {
      name: 'Swing Trend Follow',
      description: 'Suivi de tendance EMA 50/100/200 sur daily, entrée 4h. Filtre ADX > 25. Pour swing/investor.',
      rules: swingTrendRules,
      analysisTimeframe: '1d',
      entryTimeframe: '4h',
      isActive: true,
    },
  });

  // ── Stratégie 7 : BRVM Value Swing ──────────────────────────
  const brvmValueSwingRules = {
    ema_fast: 20,
    ema_slow: 50,
    ema_trend: 100,
    rsi_period: 14,
    rsi_oversold: 30,
    rsi_overbought: 70,
    rsi_bullish_zone: 45,
    rsi_bearish_zone: 55,
    min_confidence: 55,
    min_dps: 50,
    volume_spike_min: 1.1,
    use_price_action: true,
    use_sr_zones: true,
    use_patterns: true,
    atr_min_pct: 0.1,
    timeframes: ['1d'],
    trigger: 'BREAKOUT',
    profiles: ['INVESTOR', 'SWING'],
    markets: ['STOCKS'],
    filters: { regime: ['TRENDING_BULL', 'TRENDING_BEAR', 'RANGING'] },
    exit_rules: { sl_atr: 2.0, tp1_atr: 2.5, tp2_atr: 4.0 },
  };

  const brvmValueSwing = await prisma.strategy.upsert({
    where: { name: 'BRVM Value Swing' },
    update: { rules: brvmValueSwingRules, analysisTimeframe: '1d', entryTimeframe: '1d', isActive: true },
    create: {
      name: 'BRVM Value Swing',
      description: 'Swing EMA/RSI adapté aux actions BRVM (données quotidiennes, faible liquidité). Analyse et entrée en 1d.',
      rules: brvmValueSwingRules,
      analysisTimeframe: '1d',
      entryTimeframe: '1d',
      isActive: true,
    },
  });

  // ── Stratégie 8 : Synthetic Mean Reversion ─────────────────
  // Utilise le pipeline standard (EMA/RSI/MACD/BB/PA/patterns/SMC) + stats Synthetic en bonus
  const syntheticMeanRevRules = {
    ema_fast: 20,
    ema_slow: 50,
    ema_trend: 200,
    rsi_period: 14,
    rsi_oversold: 25,
    rsi_overbought: 75,
    rsi_bullish_zone: 50,
    rsi_bearish_zone: 50,
    min_confidence: 55,
    min_dps: 50,
    volume_spike_min: 1.5,
    use_price_action: true,
    use_sr_zones: true,
    use_patterns: true,
    atr_min_pct: 0.2,
    timeframes: ['5m', '15m', '1h'],
    trigger: 'MOMENTUM_CONFIRMATION',
    profiles: ['SCALPER', 'DAY', 'SWING'],
    markets: ['SYNTHETIC'],
    filters: { regime: ['RANGING', 'TRENDING_BULL', 'TRENDING_BEAR'] },
    exit_rules: { sl_atr: 1.5, tp1_atr: 1.5, tp2_atr: 2.5 },
  };

  const syntheticMeanRev = await prisma.strategy.upsert({
    where: { name: 'Synthetic Mean Reversion' },
    update: { rules: syntheticMeanRevRules, analysisTimeframe: '15m', entryTimeframe: '5m', isActive: true },
    create: {
      name: 'Synthetic Mean Reversion',
      description: 'Mean reversion sur indices Synthetic (V75, Jump, Boom/Crash). Pipeline standard EMA/RSI/MACD/BB + stats Synthetic (spike_prob, Monte Carlo). Analyse 15m, entrée 5m.',
      rules: syntheticMeanRevRules,
      analysisTimeframe: '15m',
      entryTimeframe: '5m',
      isActive: true,
    },
  });

  // ── Phase E — Gold Specialist Strategy ──
  const goldSpecialistRules = {
    ema_fast: 9,
    ema_slow: 21,
    ema_trend: 50,
    rsi_period: 14,
    rsi_oversold: 35,
    rsi_overbought: 65,
    rsi_bullish_zone: 50,
    rsi_bearish_zone: 50,
    min_confidence: 55,
    min_dps: 55,
    volume_spike_min: 1.5,
    use_price_action: true,
    use_sr_zones: true,
    use_smc: true,
    use_patterns: true,
    atr_min_pct: 0.3,
    timeframes: ['1d', '4h', '1h'],
    analysis_timeframe: '4h',
    entry_timeframe: '1h',
    trigger: 'BREAKOUT',
    markets: ['COMMODITIES'],
    profiles: ['SWING', 'DAY'],
    entry_rules: {
      ema_fast_above_slow: true,
      adx_min: 20,
    },
    filters: {
      regime: ['TRENDING_BULL', 'TRENDING_BEAR', 'VOLATILE'],
    },
    exit_rules: {
      sl_atr: 2.0,
      tp1_atr: 2.5,
      tp2_atr: 4.0,
    },
    invalidation: {
      description: 'Signal invalidé si DXY casse dans la direction opposée à la corrélation inverse attendue',
    },
  };

  const goldSpecialist = await prisma.strategy.upsert({
    where: { name: 'Gold Specialist XAU/USD' },
    update: { rules: goldSpecialistRules, analysisTimeframe: '4h', entryTimeframe: '1h', isActive: true },
    create: {
      name: 'Gold Specialist XAU/USD',
      description: 'Stratégie spécialisée XAU/USD avec corrélation DXY inverse, awareness des sessions London/NY, safe haven en régime VOLATILE, ATR adapté. EMA 9/21/50, RSI 14, SMC activé.',
      rules: goldSpecialistRules,
      analysisTimeframe: '4h',
      entryTimeframe: '1h',
      isActive: true,
    },
  });

  // Post-seed assertion: verify all strategies have markets
  const allStrategies = await prisma.strategy.findMany({ select: { name: true, rules: true } });
  for (const s of allStrategies) {
    const markets = (s.rules as Record<string, unknown>)?.markets as string[] | undefined;
    if (!markets || markets.length === 0) {
      throw new Error(`Strategy "${s.name}" has no markets field — seed may be stale, re-run with updated code`);
    }
  }

  console.log('✅ Seed completed');
  console.log(`   Markets: ${markets.length}`);
  console.log(`   Assets:  ${assets.length}`);
  console.log(`   Strategies: ${allStrategies.length} (EMA Trend+RSI, MACD Momentum, BB Squeeze, SMC Retest, Scalper RSI, Swing Trend, BRVM Value Swing, Synthetic Mean Reversion)`);
  console.log(`   User: ${admin.email} / admin123 (role: ${admin.role})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
