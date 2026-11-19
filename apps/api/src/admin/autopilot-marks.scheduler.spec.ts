import { AutopilotMarksScheduler } from './autopilot-marks.scheduler';
import { AUTOPILOT_EMAIL } from '../signals/auto-trader.service';

describe('AutopilotMarksScheduler', () => {
  let prisma: any;
  let candles: any;
  let cronConfig: any;
  let scheduler: AutopilotMarksScheduler;

  beforeEach(() => {
    prisma = {
      position: {
        findMany: jest.fn().mockResolvedValue([
          { asset: { symbol: 'BTC/USDT' } },
          { asset: { symbol: 'XRP/USDT' } },
          { asset: { symbol: 'BTC/USDT' } },
        ]),
      },
    };
    candles = { getSince: jest.fn().mockResolvedValue([]) };
    cronConfig = { isEnabled: jest.fn().mockResolvedValue(true) };
    scheduler = new AutopilotMarksScheduler(prisma, candles, cronConfig);
  });

  it('scopes the refresh to open positions of the AutoPilot system portfolio only', async () => {
    await scheduler.refresh();
    expect(prisma.position.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] },
        portfolio: { name: 'AutoPilot', type: 'PAPER', user: { email: AUTOPILOT_EMAIL } },
      }),
    }));
    expect(prisma.position.findMany.mock.calls[0][0].select).toEqual({ asset: { select: { symbol: true } } });
  });

  it('fetches a deduplicated 1m window per open symbol', async () => {
    await scheduler.refresh();
    expect(candles.getSince).toHaveBeenCalledTimes(2);
    for (const [symbol, timeframe, since] of candles.getSince.mock.calls) {
      expect(['BTC/USDT', 'XRP/USDT']).toContain(symbol);
      expect(timeframe).toBe('1m');
      expect(since.getTime()).toBeGreaterThan(Date.now() - 11 * 60_000);
    }
  });

  it('keeps refreshing other symbols when one provider fails', async () => {
    candles.getSince.mockRejectedValueOnce(new Error('provider down'));
    await expect(scheduler.refresh()).resolves.toBeUndefined();
    expect(candles.getSince).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled or without open positions', async () => {
    cronConfig.isEnabled.mockResolvedValue(false);
    await scheduler.refresh();
    expect(prisma.position.findMany).not.toHaveBeenCalled();

    cronConfig.isEnabled.mockResolvedValue(true);
    prisma.position.findMany.mockResolvedValue([]);
    await scheduler.refresh();
    expect(candles.getSince).not.toHaveBeenCalled();
  });
});
