import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

async function fetchCandles(symbol: string, timeframe: string, limit = 200) {
  const url = `http://localhost:8000/candles/${encodeURIComponent(symbol)}?timeframe=${timeframe}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'X-Engine-Key': process.env.ENGINE_API_KEY ?? '' },
  });
  if (!res.ok) throw new Error(`Failed to fetch candles for ${symbol} ${timeframe}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.candles ?? []);
}

async function seed() {
  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const candles = await fetchCandles(symbol, timeframe);
        const rows = candles.map((c: any) => ({
          id: `${symbol}_${timeframe}_${c.timestamp ?? c.time}`,
          symbol,
          timeframe,
          openTime: new Date((c.timestamp ?? c.time) * 1000),
          open: parseFloat(c.open ?? c.o),
          high: parseFloat(c.high ?? c.h),
          low: parseFloat(c.low ?? c.l),
          close: parseFloat(c.close ?? c.c),
          volume: c.volume ? parseFloat(c.volume) : null,
        }));

        await prisma.candle.createMany({
          data: rows,
          skipDuplicates: true,
        });

        console.log(`Seeded ${rows.length} candles for ${symbol} ${timeframe}`);
      } catch (error) {
        console.error(`Failed to seed ${symbol} ${timeframe}:`, error);
      }
    }
  }
}

seed()
  .then(() => console.log('Done'))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
