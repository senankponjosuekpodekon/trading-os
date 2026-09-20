import { Test } from '@nestjs/testing';
import { HybridCandleRepository } from './hybrid-candle.repository';
import { LocalCandleRepository } from './local-candle.repository';
import { EngineCandleRepository } from './engine-candle.repository';
import { BinanceCandleRepository } from './binance-candle.repository';
import { YahooCandleRepository } from './yahoo-candle.repository';
import { TwelveDataCandleRepository } from './twelvedata-candle.repository';
import { AlphaVantageCandleRepository } from './alphavantage-candle.repository';

const mockLocalRepo = {
  getSince: jest.fn(),
  store: jest.fn(),
  getLowerTimeframeWindow: jest.fn(),
};

const mockEngineRepo = {
  getSince: jest.fn(),
};

const mockBinanceRepo = {
  getSince: jest.fn(),
};

const mockYahooRepo = {
  getSince: jest.fn(),
};

const mockTwelveDataRepo = {
  getSince: jest.fn(),
};

const mockAlphaVantageRepo = {
  getSince: jest.fn(),
};

describe('HybridCandleRepository', () => {
  let repository: HybridCandleRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        HybridCandleRepository,
        { provide: LocalCandleRepository, useValue: mockLocalRepo },
        { provide: EngineCandleRepository, useValue: mockEngineRepo },
        { provide: BinanceCandleRepository, useValue: mockBinanceRepo },
        { provide: YahooCandleRepository, useValue: mockYahooRepo },
        { provide: TwelveDataCandleRepository, useValue: mockTwelveDataRepo },
        { provide: AlphaVantageCandleRepository, useValue: mockAlphaVantageRepo },
      ],
    }).compile();

    repository = module.get<HybridCandleRepository>(HybridCandleRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('should use local cache first', async () => {
    const mockCandles = [{ openTime: 1695000000000, open: 27000, high: 27100, low: 26900, close: 27050 }];
    mockLocalRepo.getSince.mockResolvedValue(mockCandles);

    const result = await repository.getSince('BTC/USDT', '1h', new Date());
    expect(mockLocalRepo.getSince).toHaveBeenCalled();
    expect(mockEngineRepo.getSince).not.toHaveBeenCalled();
    expect(result).toEqual(mockCandles);
  });

  it('should fallback to engine if local is empty', async () => {
    const mockCandles = [{ openTime: 1695000000000, open: 27000, high: 27100, low: 26900, close: 27050 }];
    mockLocalRepo.getSince.mockResolvedValue([]);
    mockEngineRepo.getSince.mockResolvedValue(mockCandles);

    const result = await repository.getSince('BTC/USDT', '1h', new Date());
    expect(mockLocalRepo.getSince).toHaveBeenCalled();
    expect(mockEngineRepo.getSince).toHaveBeenCalled();
    expect(result).toEqual(mockCandles);
  });

  it('should fallback to Binance for crypto', async () => {
    const mockCandles = [{ openTime: 1695000000000, open: 27000, high: 27100, low: 26900, close: 27050 }];
    mockLocalRepo.getSince.mockResolvedValue([]);
    mockEngineRepo.getSince.mockResolvedValue([]);
    mockBinanceRepo.getSince.mockResolvedValue(mockCandles);

    const result = await repository.getSince('BTC/USDT', '1h', new Date());
    expect(mockBinanceRepo.getSince).toHaveBeenCalled();
    expect(result).toEqual(mockCandles);
  });

  it('should fallback to TwelveData for forex', async () => {
    const mockCandles = [{ openTime: 1695000000000, open: 1.0850, high: 1.0860, low: 1.0840, close: 1.0855 }];
    mockLocalRepo.getSince.mockResolvedValue([]);
    mockEngineRepo.getSince.mockResolvedValue([]);
    mockTwelveDataRepo.getSince.mockResolvedValue(mockCandles);

    const result = await repository.getSince('EUR/USD', '1h', new Date());
    expect(mockTwelveDataRepo.getSince).toHaveBeenCalled();
    expect(result).toEqual(mockCandles);
  });

  it('should fallback to Yahoo if TwelveData fails', async () => {
    const mockCandles = [{ openTime: 1695000000000, open: 1.0850, high: 1.0860, low: 1.0840, close: 1.0855 }];
    mockLocalRepo.getSince.mockResolvedValue([]);
    mockEngineRepo.getSince.mockResolvedValue([]);
    mockTwelveDataRepo.getSince.mockResolvedValue([]);
    mockYahooRepo.getSince.mockResolvedValue(mockCandles);

    const result = await repository.getSince('EUR/USD', '1h', new Date());
    expect(mockYahooRepo.getSince).toHaveBeenCalled();
    expect(result).toEqual(mockCandles);
  });
});
