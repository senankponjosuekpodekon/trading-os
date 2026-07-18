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
          circulating_supply: 120000000,
          market_cap: 300000000000,
          inflation_rate: 0.4,
        },
      }),
    );
    const data = await service.tokenomics('ETH');
    expect(data).toHaveLength(1);
    expect(data[0].assetSymbol).toBe('ETH');
    expect(data[0].marketCap).toBe(300000000000);
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
