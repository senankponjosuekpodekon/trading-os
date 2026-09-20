import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { TwelveDataCandleRepository } from './twelvedata-candle.repository';
import { of } from 'rxjs';
import { AxiosResponse } from 'axios';

const mockHttpService = {
  get: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: string) => {
    if (key === 'TWELVE_DATA_API_KEY') return 'test-api-key';
    return defaultValue;
  }),
};

describe('TwelveDataCandleRepository', () => {
  let repository: TwelveDataCandleRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TwelveDataCandleRepository,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    repository = module.get<TwelveDataCandleRepository>(TwelveDataCandleRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('should return candles for EUR/USD', async () => {
    const mockCandles = {
      values: [
        { datetime: '2026-09-18T00:00:00Z', open: '1.0850', high: '1.0860', low: '1.0840', close: '1.0855' },
        { datetime: '2026-09-18T01:00:00Z', open: '1.0855', high: '1.0870', low: '1.0850', close: '1.0865' },
      ],
    };

    mockHttpService.get.mockReturnValue(
      of({ data: mockCandles } as AxiosResponse),
    );

    const since = new Date('2026-09-17T00:00:00Z');
    const result = await repository.getSince('EUR/USD', '1h', since);

    expect(result.length).toBe(2);
    expect(result[0].open).toBe(1.0850);
    expect(result[0].high).toBe(1.0860);
    expect(result[0].low).toBe(1.0840);
    expect(result[0].close).toBe(1.0855);
  });

  it('should return empty array if no API key', async () => {
    const repoNoKey = new TwelveDataCandleRepository(
      mockHttpService as any,
      { get: jest.fn(() => '') } as any,
    );

    const result = await repoNoKey.getSince('EUR/USD', '1h', new Date());
    expect(result).toEqual([]);
  });

  it('should return empty array on error', async () => {
    mockHttpService.get.mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await repository.getSince('EUR/USD', '1h', new Date());
    expect(result).toEqual([]);
  });
});
