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
    update: {},
    create: {
      email: 'admin@example.com',
      password: adminPassword,
      name: 'Admin User',
      role: 'ADMIN' as any,
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
  };

  const strategy = await prisma.strategy.upsert({
    where: { name: 'EMA Trend + RSI' },
    update: { rules: emaTrendRsiRules },
    create: {
      name: 'EMA Trend + RSI',
      description: 'Tendance EMA 20/50/200 avec confirmation RSI. Signal BUY si EMA20 > EMA50 et RSI en zone bullish (45+).',
      rules: emaTrendRsiRules,
    },
  });

  console.log('✅ Seed completed');
  console.log(`   Markets: ${markets.length}`);
  console.log(`   Assets:  ${assets.length}`);
  console.log(`   Strategy: ${strategy.name}`);
  console.log(`   User: ${admin.email} / admin123 (role: ${admin.role})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
