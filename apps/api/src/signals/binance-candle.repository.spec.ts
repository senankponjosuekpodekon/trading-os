import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { BinanceCandleRepository } from './binance-candle.repository';
import { of } from 'rxjs';
import { AxiosResponse } from 'axios';

const mockHttpService = {
  get: jest.fn(),
};

describe('BinanceCandleRepository', () => {
  let repository: BinanceCandleRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BinanceCandleRepository,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    repository = module.get<BinanceCandleRepository>(BinanceCandleRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('should return candles for BTC/USDT', async () => {
    const mockCandles = [
      [1695000000000, '27000', '27100', '26900', '27050', '100'],
      [1695003600000, '27050', '27200', '27000', '27150', '150'],
    ];

    mockHttpService.get.mockReturnValue(
      of({ data: mockCandles } as AxiosResponse),
    );

    const since = new Date(1695000000000);
    const result = await repository.getSince('BTC/USDT', '1h', since);

    expect(result.length).toBe(2);
    expect(result[0].open).toBe(27000);
    expect(result[0].high).toBe(27100);
    expect(result[0].low).toBe(26900);
    expect(result[0].close).toBe(27050);
  });

  it('should return empty array on error', async () => {
    mockHttpService.get.mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await repository.getSince('BTC/USDT', '1h', new Date());
    expect(result).toEqual([]);
  });
});
