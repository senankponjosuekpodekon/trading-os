import { AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;
  const engine = { get: jest.fn(), post: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiService(engine as any);
  });

  it('hiddenGems transmet max_volume et les défauts calibrés à l\'engine', async () => {
    engine.get.mockResolvedValue({ gems: [] });
    await service.hiddenGems(50_000, 150_000, 800_000, 50, false);
    expect(engine.get).toHaveBeenCalledWith('/ml/hidden-gems', {
      params: { min_liquidity: 50_000, min_volume: 150_000, max_volume: 800_000, limit: 50 },
      timeout: 30_000,
    });
  });

  it('hiddenGems omet max_volume quand null (pas de plafond)', async () => {
    engine.get.mockResolvedValue({ gems: [] });
    await service.hiddenGems(50_000, 150_000, null, 25, true);
    const params = engine.get.mock.calls[0][1].params;
    expect(params.max_volume).toBeUndefined();
    expect(params.refresh).toBe('true');
    expect(params.limit).toBe(25);
  });

  it('gemPaperStats appelle l\'endpoint engine', async () => {
    engine.get.mockResolvedValue({ open: [], closed: [], win_rate: 0 });
    const res = await service.gemPaperStats();
    expect(engine.get).toHaveBeenCalledWith('/ml/gem-paper/stats', { timeout: 15_000 });
    expect(res.win_rate).toBe(0);
  });
});
