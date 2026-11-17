import { Test } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Mt5Connector } from './mt5.connector';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
  });

  it('should be defined', () => {
    expect(connector).toBeDefined();
  });

  it('should have exchange name MT5', () => {
    expect(connector.exchange).toBe(ExchangeName.MT5);
  });

  describe('placeOrder', () => {
    it('should place a market buy order successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          filled: true,
          price: 1.085,
          deal: 998877,
          order: 123456,
          volume: 0.1,
        },
      });

      const result = await connector.placeOrder('ignored', 'ignored', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
      });

      expect(result.orderId).toBe('123456');
      expect(result.status).toBe('FILLED');
      expect(result.exchange).toBe(ExchangeName.MT5);
      expect(result.raw?.mt5_symbol).toBe('EURUSD');

      const [url, body, opts] = mockedAxios.post.mock.calls[0];
      expect(url).toBe('http://localhost:5555/order');
      expect((body as any).side).toBe('BUY');
      expect((body as any).symbol).toBe('EURUSD');
      expect((opts as any).headers.Authorization).toBe('Bearer tok');
    });

    it('should pass stopPrice as sl to the bridge', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { filled: true, price: 1.08, order: 1, volume: 0.1 },
      });

      await connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
        stopPrice: 1.07,
      });

      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(body.sl).toBe(1.07);
    });

    it('should reject non-MARKET orders', async () => {
      await expect(
        connector.placeOrder('x', 'y', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'LIMIT',
          quantity: 0.1,
          price: 1.08,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on ECONNREFUSED', async () => {
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNREFUSED' });

      await expect(
        connector.placeOrder('x', 'y', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ServiceUnavailableException on timeout', async () => {
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });

      await expect(
        connector.placeOrder('x', 'y', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ServiceUnavailableException on 503 (terminal disconnected)', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 503, data: { error: 'mt5_disconnected' } },
      });

      await expect(
        connector.placeOrder('x', 'y', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw BadRequestException on 403 (symbol_not_allowed)', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 403, data: { error: 'symbol_not_allowed' } },
      });

      await expect(
        connector.placeOrder('x', 'y', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(BadRequestException);
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

      const [url] = mockedAxios.get.mock.calls[0];
      expect(url).toBe('http://localhost:5555/account');
    });
  });

  describe('validateCredentials', () => {
    it('should return true when bridge reports connected', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { connected: true, initialized: true },
      });
      expect(await connector.validateCredentials('x', 'y')).toBe(true);
    });

    it('should return false when terminal not connected', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { connected: false, initialized: true },
      });
      expect(await connector.validateCredentials('x', 'y')).toBe(false);
    });

    it('should return false on error', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('fail'));
      expect(await connector.validateCredentials('x', 'y')).toBe(false);
    });
  });

  describe('symbol mapping', () => {
    it('should map XAU/USD to XAUUSD', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { filled: true, price: 2000, order: 1, volume: 0.1 },
      });

      await connector.placeOrder('x', 'y', {
        symbol: 'XAU/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
      });

      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(body.symbol).toBe('XAUUSD');
    });

    it('should accept raw 6-char format', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { filled: true, price: 1.08, order: 1, volume: 0.1 },
      });

      await connector.placeOrder('x', 'y', {
        symbol: 'GBPJPY',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
      });

      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(body.symbol).toBe('GBPJPY');
    });

    it('should throw BadRequestException for unsupported symbol', async () => {
      await expect(
        connector.placeOrder('x', 'y', {
          symbol: 'UNKNOWN',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('volume normalization', () => {
    it('should convert large quantity to lots', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { filled: true, price: 1.08, order: 1, volume: 0.1 },
      });

      await connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 10000,
      });

      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(body.volume).toBe(0.1);
    });

    it('should enforce minimum 0.01 lot', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { filled: true, price: 1.08, order: 1, volume: 0.01 },
      });

      await connector.placeOrder('x', 'y', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.001,
      });

      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(body.volume).toBe(0.01);
    });
  });
});
