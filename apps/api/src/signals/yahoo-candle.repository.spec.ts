import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { YahooCandleRepository } from './yahoo-candle.repository';
import { of } from 'rxjs';
import { AxiosResponse } from 'axios';

const mockHttpService = {
  get: jest.fn(),
};

describe('YahooCandleRepository', () => {
  let repository: YahooCandleRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        YahooCandleRepository,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    repository = module.get<YahooCandleRepository>(YahooCandleRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('should return candles for AAPL', async () => {
    const mockData = {
      chart: {
        result: [{
          timestamp: [1695000000, 1695003600],
          indicators: {
            quote: [{
              open: [170.0, 171.0],
              high: [171.5, 172.0],
              low: [169.5, 170.5],
              close: [171.0, 171.5],
            }],
          },
        }],
      },
    };

    mockHttpService.get.mockReturnValue(
      of({ data: mockData } as AxiosResponse),
    );

    const since = new Date(1695000000000);
    const result = await repository.getSince('AAPL', '1h', since);

    expect(result.length).toBe(2);
    expect(result[0].open).toBe(170.0);
    expect(result[0].high).toBe(171.5);
    expect(result[0].low).toBe(169.5);
    expect(result[0].close).toBe(171.0);
  });

  it('should return empty array on error', async () => {
    mockHttpService.get.mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await repository.getSince('AAPL', '1h', new Date());
    expect(result).toEqual([]);
  });
});
