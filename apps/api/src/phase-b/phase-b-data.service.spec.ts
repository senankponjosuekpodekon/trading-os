import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { PhaseBDataService } from './phase-b-data.service';

describe('PhaseBDataService', () => {
  let service: PhaseBDataService;

  const mockHttp = { get: jest.fn() };
  const mockConfig = {
    get: jest.fn().mockImplementation((_key: string, def?: string) => def),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhaseBDataService,
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<PhaseBDataService>(PhaseBDataService);
    jest.clearAllMocks();
  });

  it('maps live engine tokenomics data when available', async () => {
    mockHttp.get.mockReturnValue(
      of({
        data: {
          symbol: 'ETH',
          next_unlock_pct: 0.4,
          next_unlock_date: null,
          top10_holders_pct: 42.0,
          source: 'api',
        },
      }),
    );
    const data = await service.tokenomics('ETH');
    expect(data).toHaveLength(1);
    expect(data[0].assetSymbol).toBe('ETH');
    expect(data[0].nextUnlockPct).toBe(0.4);
    expect(data[0].top10HoldersPct).toBe(42.0);
    expect(data[0].source).toBe('api');
  });

  it('falls back to mock tokenomics when engine is down', async () => {
    mockHttp.get.mockReturnValue(throwError(() => new Error('down')));
    const data = await service.tokenomics();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].assetSymbol).toBeDefined();
  });

  it('maps live BRVM quotes when available', async () => {
    mockHttp.get.mockReturnValue(
      of({
        data: {
          quotes: [
            { symbol: 'SNTS', name: 'Sonatel', sector: 'Telecom', price: 8000, change_percent: 1.2, volume: 500 },
          ],
        },
      }),
    );
    const data = await service.brvm();
    expect(data).toHaveLength(1);
    expect(data[0].symbol).toBe('SNTS');
    expect(data[0].priceXof).toBe(8000);
  });

  it('falls back to mock BRVM data and applies sector filter', async () => {
    mockHttp.get.mockReturnValue(throwError(() => new Error('down')));
    const data = await service.brvm('Banque');
    expect(data).toHaveLength(1);
    expect(data[0].sector).toBe('Banque');
  });

  it('falls back to mock synthetic data with underlying filter', async () => {
    mockHttp.get.mockReturnValue(throwError(() => new Error('down')));
    const data = await service.synthetic('BTC');
    expect(data).toHaveLength(1);
    expect(data[0].underlying).toBe('BTC');
  });
});
