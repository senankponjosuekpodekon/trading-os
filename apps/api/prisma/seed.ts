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

  const strategy = await prisma.strategy.upsert({
    where: { name: 'EMA Trend + RSI' },
    update: {},
    create: {
      name: 'EMA Trend + RSI',
      description: 'Tendance EMA 20/50/200 avec confirmation RSI. Signal BUY si EMA20 > EMA50 et RSI entre 45-65.',
      rules: {
        conditions: {
          buy: [
            { indicator: 'ema20', operator: 'gt', target: 'ema50' },
            { indicator: 'rsi', operator: 'between', min: 45, max: 65 },
            { indicator: 'close', operator: 'gt', target: 'ema200' },
          ],
          sell: [
            { indicator: 'ema20', operator: 'lt', target: 'ema50' },
            { indicator: 'rsi', operator: 'between', min: 35, max: 55 },
            { indicator: 'close', operator: 'lt', target: 'ema200' },
          ],
        },
        scoring: {
          ema_alignment: 30,
          rsi_zone: 20,
          above_ema200: 25,
          volume_ratio: 15,
          atr_ok: 10,
        },
      },
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
