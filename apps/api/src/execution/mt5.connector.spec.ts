import { Test } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Mt5Connector } from './mt5.connector';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CONTRACT = {
  contract_size: 100000, volume_min: 0.01, volume_max: 50, volume_step: 0.01,
  point: 0.00001, digits: 5, stops_level: 20,
  tick_value: 1, tick_size: 0.00001, margin_initial: 0,
};
const QUOTE = { bid: 1.08, ask: 1.08002 };

function mockPrelude() {
  mockedAxios.get
    .mockResolvedValueOnce({ data: CONTRACT })   // /contract/<symbol>
    .mockResolvedValueOnce({ data: QUOTE });     // /quote/<symbol>
}

describe('Mt5Connector', () => {
  let connector: Mt5Connector;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        Mt5Connector,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'MT5_BRIDGE_URL') return 'http://localhost:5555';
              if (key === 'MT5_BRIDGE_TOKEN') return 'tok';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    connector = moduleRef.get(Mt5Connector);
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
  });

  it('should be defined', () => {
    expect(connector).toBeDefined();
  });

  it('should have exchange name MT5', () => {
    expect(connector.exchange).toBe(ExchangeName.MT5);
  });

  describe('placeOrder', () => {
    it('places a market order with lots converted from units', async () => {
      mockPrelude();
      mockedAxios.post.mockResolvedValueOnce({
        data: { filled: true, price: 1.08002, deal: 998877, order: 123456, volume: 0.1 },
      });

      const result = await connector.placeOrder('ignored', 'ignored', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 10000,
      });

      expect(result.orderId).toBe('123456');
      expect(result.status).toBe('FILLED');
      expect(result.raw?.mt5_symbol).toBe('EURUSD');
      expect(result.raw?.lots).toBe(0.1);
      expect(result.raw?.reconciled).toBe(false);

      const [url, body, opts] = mockedAxios.post.mock.calls[0];
      expect(url).toBe('http://localhost:5555/order');
      expect((body as any).symbol).toBe('EURUSD');
      expect((body as any).volume).toBe(0.1);
      expect((opts as any).headers.Authorization).toBe('Bearer tok');
    });

    it('fetches the real contract before sizing — fail closed without it', async () => {
      mockedAxios.get.mockRejectedValueOnce({ code: 'ECONNREFUSED' });
      await expect(connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 10000,
      })).rejects.toThrow(ServiceUnavailableException);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('passes sl and tp to the bridge after stops_level validation', async () => {
      mockPrelude();
      mockedAxios.post.mockResolvedValueOnce({
        data: { filled: true, price: 1.08, order: 1, volume: 0.1 },
      });
      await connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 10000,
        stopPrice: 1.079, takeProfit: 1.081,
      });
      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(body.sl).toBe(1.079);
      expect(body.tp).toBe(1.081);
    });

    it('rejects stops closer than the broker stops_level', async () => {
      mockPrelude();
      await expect(connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 10000,
        stopPrice: 1.08001, // distance à l'ask 0.00001 < 20 pts
      })).rejects.toThrow(/trop proche/);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('rejects quantities below the broker minimum — no silent clamp', async () => {
      mockPrelude();
      await expect(connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 500,
      })).rejects.toThrow(/minimum broker/);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('rejects when the fixed margin exceeds free margin', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { ...CONTRACT, margin_initial: 6000 } })
        .mockResolvedValueOnce({ data: QUOTE })
        .mockResolvedValueOnce({ data: { margin_free: 5000 } });
      await expect(connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 100000,
      })).rejects.toThrow(/marge insuffisante/);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('reconciles a fill from deal history after an ambiguous timeout', async () => {
      mockPrelude();
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
      const now = Date.now();
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          items: [{
            ticket: '777', order: '888', position_id: '999', magic: '20261118',
            type: 0, symbol: 'EURUSD', volume: 0.1, price: 1.0801,
            time_msc: now - 1000,
          }],
        },
      });
      const result = await connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 10000,
      });
      expect(result.status).toBe('FILLED');
      expect(result.raw?.reconciled).toBe(true);
      expect(result.orderId).toBe('888');
    });

    it('does not reconcile deals from another symbol or magic', async () => {
      mockPrelude();
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          items: [
            { ticket: '1', order: '2', magic: '20261118', type: 0, symbol: 'GBPUSD', volume: 0.1, price: 1.2, time_msc: Date.now() },
            { ticket: '3', order: '4', magic: '999', type: 0, symbol: 'EURUSD', volume: 0.1, price: 1.08, time_msc: Date.now() },
          ],
        },
      });
      await expect(connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 10000,
      })).rejects.toThrow(ServiceUnavailableException);
    });

    it('should reject non-MARKET orders', async () => {
      await expect(
        connector.placeOrder('x', 'y', {
          symbol: 'EUR/USD', side: 'BUY', type: 'LIMIT', quantity: 10000, price: 1.08,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on 503 (terminal disconnected)', async () => {
      mockPrelude();
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNREFUSED' });
      mockedAxios.get.mockResolvedValueOnce({ data: { items: [] } }); // reconcile: aucun deal
      await expect(connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD', side: 'BUY', type: 'MARKET', quantity: 10000,
      })).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getAccountBalance', () => {
    it('should map bridge account to balance array', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { balance: 5000, equity: 5050, currency: 'USD', margin: 100, margin_free: 4950 },
      });
      const result = await connector.getAccountBalance('x', 'y');
      expect(result).toHaveLength(1);
      expect(result[0].asset).toBe('USD');
      expect(result[0].free).toBe('4950');
      expect(result[0].locked).toBe('100');
      expect(mockedAxios.get.mock.calls[0][0]).toBe('http://localhost:5555/account');
    });
  });

  describe('validateCredentials', () => {
    it('should return true when bridge reports connected', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { connected: true, initialized: true } });
      expect(await connector.validateCredentials('x', 'y')).toBe(true);
    });

    it('should return false when terminal not connected', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { connected: false, initialized: true } });
      expect(await connector.validateCredentials('x', 'y')).toBe(false);
    });

    it('should return false on error', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('fail'));
      expect(await connector.validateCredentials('x', 'y')).toBe(false);
    });
  });

  describe('symbol mapping', () => {
    it('should map XAU/USD to XAUUSD', async () => {
      mockPrelude();
      mockedAxios.post.mockResolvedValueOnce({ data: { filled: true, price: 2000, order: 1, volume: 0.1 } });
      await connector.placeOrder('x', 'y', { symbol: 'XAU/USD', side: 'BUY', type: 'MARKET', quantity: 1000 });
      expect((mockedAxios.post.mock.calls[0][1] as any).symbol).toBe('XAUUSD');
    });

    it('should accept raw 6-char format', async () => {
      mockPrelude();
      mockedAxios.post.mockResolvedValueOnce({ data: { filled: true, price: 1.08, order: 1, volume: 0.1 } });
      await connector.placeOrder('x', 'y', { symbol: 'GBPJPY', side: 'BUY', type: 'MARKET', quantity: 10000 });
      expect((mockedAxios.post.mock.calls[0][1] as any).symbol).toBe('GBPJPY');
    });

    it('should throw BadRequestException for unsupported symbol', async () => {
      await expect(
        connector.placeOrder('x', 'y', { symbol: 'UNKNOWN', side: 'BUY', type: 'MARKET', quantity: 10000 }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
