import { TrackRecordService } from './track-record.service';

const mockDb = {
  findFirst: jest.fn(),
  findMany: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockPrisma = { trackedCall: mockDb };
const mockHttp = { get: jest.fn() };
const mockConfig = { get: jest.fn().mockReturnValue('http://engine:8000') };

describe('TrackRecordService', () => {
  let service: TrackRecordService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrackRecordService(mockPrisma as any, mockHttp as any, mockConfig as any);
  });

  it('dedups an already-open call for same source+symbol+token', async () => {
    mockDb.findFirst.mockResolvedValue({ id: 'c1', symbol: 'PEPE' });
    const res = await service.record({ symbol: 'PEPE', source: 'engine:moonshot', tokenAddress: '0xabc' });
    expect(res.dedup).toBe(true);
    expect(mockDb.create).not.toHaveBeenCalled();
  });

  it('records with provided entry price without resolving', async () => {
    mockDb.findFirst.mockResolvedValue(null);
    mockDb.create.mockImplementation(({ data }) => ({ id: 'c2', ...data }));
    const res = await service.record({ symbol: 'LDO', source: 'manual:ifeanyi', entryPrice: 1.23 });
    expect(res.call.entryPrice).toBe(1.23);
    expect(res.call.peakPrice).toBe(1.23);
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it('computes perf, multiple and peak correctly', async () => {
    mockDb.findMany.mockResolvedValue([{
      id: 'c1', symbol: 'VIRTUAL', source: 'manual:ifeanyi',
      entryPrice: 1, entryAt: new Date(Date.now() - 14 * 86_400_000),
      lastPrice: 2.5, peakPrice: 4, closedAt: null,
    }]);
    const res = await service.list();
    const c = res.calls[0];
    expect(c.perfPct).toBe(150);
    expect(c.multiple).toBe(2.5);
    expect(c.peakPct).toBe(300);
    expect(c.daysHeld).toBe(14);
    expect(res.kpis[0].hitRate).toBe(100);
    expect(res.kpis[0].best.symbol).toBe('VIRTUAL');
  });

  it('separates KPIs per source', async () => {
    mockDb.findMany.mockResolvedValue([
      { id: 'a', symbol: 'X', source: 'engine:moonshot', entryPrice: 1, entryAt: new Date(), lastPrice: 2, peakPrice: 2, closedAt: null },
      { id: 'b', symbol: 'Y', source: 'manual:coach', entryPrice: 1, entryAt: new Date(), lastPrice: 0.5, peakPrice: 1, closedAt: null },
    ]);
    const res = await service.list();
    const engine = res.kpis.find((k: any) => k.source === 'engine:moonshot');
    const coach = res.kpis.find((k: any) => k.source === 'manual:coach');
    expect(engine.hitRate).toBe(100);
    expect(coach.hitRate).toBe(0);
    expect(coach.avgPerfPct).toBe(-50);
  });
});
