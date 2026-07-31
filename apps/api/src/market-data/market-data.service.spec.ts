import { Test, TestingModule } from '@nestjs/testing';
import { MarketDataService } from './market-data.service';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

describe('MarketDataService', () => {
  let service: MarketDataService;

  const mockHttp = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MarketDataService, { provide: HttpService, useValue: mockHttp }],
    }).compile();
    service = module.get<MarketDataService>(MarketDataService);
    jest.clearAllMocks();
  });

  describe('getFearGreed', () => {
    it('should return formatted fear & greed data', async () => {
      mockHttp.get.mockReturnValue(of({
        data: {
          data: [
            { value: 75, value_classification: 'Greed', timestamp: '1689450000' },
          ],
        },
      }));

      const result = await service.getFearGreed();

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(75);
      expect(result[0].classification).toBe('Greed');
    });

    it('should return empty array on error', async () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('network')));

      const result = await service.getFearGreed();

      expect(result).toEqual([]);
    });
  });

  describe('getFundingRates', () => {
    it('should return funding rates for wanted symbols', async () => {
      mockHttp.get.mockReturnValue(of({ data: [
        { symbol: 'BTCUSDT', fundingRate: '0.0001', fundingTime: 1689450000000 },
        { symbol: 'ETHUSDT', fundingRate: '-0.0002', fundingTime: 1689450000000 },
      ]}));

      const result = await service.getFundingRates(['BTCUSDT']);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTC/USDT');
      expect(result[0].fundingRate).toBe(0.0001);
    });

    it('should return empty array on error', async () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('network')));

      const result = await service.getFundingRates();

      expect(result).toEqual([]);
    });
  });

  describe('getEconomicCalendar', () => {
    it('should return filtered high/medium impact events with categories', async () => {
      // Use a future date so the past-event filter doesn't remove it
      const futureDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      mockHttp.get.mockReturnValue(of({ data: [
        { date: futureDate, time: '14:30', country: 'USD', impact: 'High', title: 'CPI', forecast: '0.3%', previous: '0.4%' },
        { date: futureDate, time: '08:00', country: 'EUR', impact: 'Low', title: 'Retail sales', forecast: '', previous: '' },
      ]}));

      const result = await service.getEconomicCalendar();

      const external = result.filter(e => e.title === 'CPI');
      expect(external).toHaveLength(1);
      expect(external[0].category).toBe('CPI');
      // No hardcoded fallback events prepended
      expect(result.some(e => e.category === 'FOMC')).toBe(false);
    });

    it('should return empty array on error (no stale hardcoded events)', async () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('network')));

      const result = await service.getEconomicCalendar();

      expect(result).toEqual([]);
    });
  });

  describe('getOnChainBtc', () => {
    it('should merge blockchair stats and mempool fees', async () => {
      mockHttp.get
        .mockReturnValueOnce(of({ data: {
          data: {
            market_data: { price_usd: 65000, market_cap_usd: 1200000000000 },
            blocks_24h: 150,
            transactions_24h: 300000,
            difficulty: 80000000000000,
            hashrate_24h: 500000000000000000000,
            average_transaction_fee_24h: 0.0001,
            mempool_size: 50000,
          },
        }}))
        .mockReturnValueOnce(of({ data: { fastestFee: 50 } }));

      const result = await service.getOnChainBtc();

      expect(result).not.toBeNull();
      expect(result!.price).toBe(65000);
      expect(result!.suggestedFee).toBe(50);
      expect(result!.mempoolSize).toBe(50000);
    });

    it('should return null on error', async () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('network')));

      const result = await service.getOnChainBtc();

      expect(result).toBeNull();
    });
  });

  describe('getOnChainEth', () => {
    it('should return formatted ethereum on-chain data', async () => {
      mockHttp.get.mockReturnValue(of({ data: {
        data: {
          market_data: { price_usd: 3400, market_cap_usd: 400000000000 },
          transactions_24h: 1000000,
          blocks_24h: 5000,
          average_transaction_fee_24h: 0.001,
          suggested_transaction_fee_median: 25,
        },
      }}));

      const result = await service.getOnChainEth();

      expect(result).not.toBeNull();
      expect(result!.price).toBe(3400);
      expect(result!.gasPriceMedian).toBe(25);
    });

    it('should return null on error', async () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('network')));

      const result = await service.getOnChainEth();

      expect(result).toBeNull();
    });
  });

  describe('getSpotPerpBasis', () => {
    it('should compute basis for requested symbols', async () => {
      mockHttp.get
        .mockReturnValueOnce(of({ data: { price: '65000.00' } }))
        .mockReturnValueOnce(of({ data: { price: '65130.00' } }));

      const result = await service.getSpotPerpBasis(['BTCUSDT']);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTC/USDT');
      expect(result[0].basis).toBe(0.2);
    });

    it('should skip pairs with missing prices', async () => {
      mockHttp.get
        .mockReturnValueOnce(of({ data: { price: '0' } }))
        .mockReturnValueOnce(of({ data: { price: '65130.00' } }));

      const result = await service.getSpotPerpBasis(['BTCUSDT']);

      expect(result).toHaveLength(0);
    });

    it('should return empty array on error', async () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('network')));

      const result = await service.getSpotPerpBasis();

      expect(result).toEqual([]);
    });
  });

  describe('getCot', () => {
    it('should return COT snapshot for BTC', async () => {
      mockHttp.get.mockReturnValue(of({ data: [{
        report_date_as_yyyy_mm_dd: '2026-07-14',
        non_comm_positions_long_all: 5000,
        non_comm_positions_short_all: 3000,
        comm_positions_long_all: 1200,
        comm_positions_short_all: 1500,
        open_interest_all: 10000,
      }]}));

      const result = await service.getCot('BTC');

      expect(result).not.toBeNull();
      expect(result!.asset).toBe('BTC');
      expect(result!.nonCommercialNet).toBe(2000);
      expect(result!.openInterest).toBe(10000);
    });

    it('should return null for unknown asset', async () => {
      const result = await service.getCot('UNKNOWN');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('network')));

      const result = await service.getCot('BTC');

      expect(result).toBeNull();
    });
  });
});
