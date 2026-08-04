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
              if (key === 'MT5_BRIDGE_URL') return 'http://localhost:8001';
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
          ticket: 123456,
          price: 1.0850,
          volume: 0.1,
          status: 'FILLED',
          broker: 'Exness-MT5Real',
        },
      });

      const result = await connector.placeOrder('5032567890', 'password', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
      });

      expect(result.orderId).toBe('123456');
      expect(result.status).toBe('FILLED');
      expect(result.exchange).toBe(ExchangeName.MT5);
      expect(result.raw?.broker).toBe('Exness-MT5Real');
    });

    it('should throw BadRequestException when login is missing', async () => {
      await expect(
        connector.placeOrder('', 'password', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when password is missing', async () => {
      await expect(
        connector.placeOrder('5032567890', '', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on ECONNREFUSED', async () => {
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNREFUSED' });

      await expect(
        connector.placeOrder('5032567890', 'password', {
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
        connector.placeOrder('5032567890', 'password', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw BadRequestException on bridge error response', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 400, data: { error: 'Invalid symbol' } },
      });

      await expect(
        connector.placeOrder('5032567890', 'password', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on 401 (invalid login)', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 401, data: { error: 'Auth failed' } },
      });

      await expect(
        connector.placeOrder('bad', 'bad', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAccountBalance', () => {
    it('should return balance array', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { balance: 5000, equity: 5000, currency: 'USD' },
      });

      const result = await connector.getAccountBalance('5032567890', 'password');
      expect(result).toHaveLength(1);
      expect(result[0].asset).toBe('USD');
      expect(result[0].free).toBe('5000');
    });

    it('should throw BadRequestException when credentials missing', async () => {
      await expect(connector.getAccountBalance('', '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateCredentials', () => {
    it('should return true when bridge returns valid', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { valid: true } });
      expect(await connector.validateCredentials('5032567890', 'password')).toBe(true);
    });

    it('should return false on error', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('fail'));
      expect(await connector.validateCredentials('bad', 'bad')).toBe(false);
    });
  });

  describe('symbol mapping', () => {
    it('should map EUR/USD to EURUSD', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { ticket: 1, price: 1.08, volume: 0.1, status: 'FILLED' },
      });

      await connector.placeOrder('5032567890', 'password', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.symbol).toBe('EURUSD');
    });

    it('should map XAU/USD to XAUUSD', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { ticket: 1, price: 2000, volume: 0.1, status: 'FILLED' },
      });

      await connector.placeOrder('5032567890', 'password', {
        symbol: 'XAU/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.symbol).toBe('XAUUSD');
    });

    it('should accept raw 6-char format', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { ticket: 1, price: 1.08, volume: 0.1, status: 'FILLED' },
      });

      await connector.placeOrder('5032567890', 'password', {
        symbol: 'GBPJPY',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.symbol).toBe('GBPJPY');
    });

    it('should throw BadRequestException for unsupported symbol', async () => {
      await expect(
        connector.placeOrder('5032567890', 'password', {
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
        data: { ticket: 1, price: 1.08, volume: 0.1, status: 'FILLED' },
      });

      await connector.placeOrder('5032567890', 'password', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 10000,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.volume).toBe(0.1);
    });

    it('should enforce minimum 0.01 lot', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { ticket: 1, price: 1.08, volume: 0.01, status: 'FILLED' },
      });

      await connector.placeOrder('5032567890', 'password', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.001,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.volume).toBe(0.01);
    });
  });
});
