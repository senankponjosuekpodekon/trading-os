import { Test } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BinanceConnector } from './binance.connector';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BinanceConnector', () => {
  let connector: BinanceConnector;
  let configService: Partial<ConfigService>;
  let mockClient: { post: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    mockClient = {
      post: jest.fn(),
      get: jest.fn(),
    };
    (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'BINANCE_USE_TESTNET') return 'false';
        if (key === 'BINANCE_API_KEY') return 'test-key';
        if (key === 'BINANCE_API_SECRET') return 'test-secret';
        return undefined;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BinanceConnector,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    connector = moduleRef.get(BinanceConnector);
    jest.clearAllMocks();
    (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);
  });

  it('should be defined', () => {
    expect(connector).toBeDefined();
  });

  it('should have exchange name BINANCE', () => {
    expect(connector.exchange).toBe(ExchangeName.BINANCE);
  });

  describe('placeOrder', () => {
    it('should place a market buy order successfully', async () => {
      mockClient.post.mockResolvedValueOnce({
        data: {
          orderId: 123456,
          status: 'FILLED',
          executedQty: '0.001',
          cummulativeQuoteQty: '50.00',
        },
      });

      const result = await connector.placeOrder('key', 'secret', {
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.001,
      });

      expect(result.orderId).toBe('123456');
      expect(result.status).toBe('FILLED');
      expect(result.executedQty).toBe('0.001');
      expect(result.exchange).toBe(ExchangeName.BINANCE);
    });

    it('should throw BadRequestException on Binance API error', async () => {
      mockClient.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: { msg: 'Invalid symbol', code: -1121 },
        },
      });

      await expect(
        connector.placeOrder('key', 'secret', {
          symbol: 'INVALID',
          side: 'BUY',
          type: 'MARKET',
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on timeout', async () => {
      mockClient.post.mockRejectedValueOnce({
        code: 'ECONNABORTED',
        message: 'timeout',
      });

      await expect(
        connector.placeOrder('key', 'secret', {
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.001,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ServiceUnavailableException on rate limit (429)', async () => {
      mockClient.post.mockRejectedValueOnce({
        response: { status: 429, data: { msg: 'Too many requests' } },
      });

      await expect(
        connector.placeOrder('key', 'secret', {
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.001,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getAccountBalance', () => {
    it('should return balances array', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: {
          balances: [
            { asset: 'BTC', free: '0.5', locked: '0.1' },
            { asset: 'USDT', free: '1000', locked: '0' },
          ],
        },
      });

      const result = await connector.getAccountBalance('key', 'secret');
      expect(result).toHaveLength(2);
      expect(result[0].asset).toBe('BTC');
      expect(result[0].free).toBe('0.5');
    });

    it('should throw BadRequestException on API error', async () => {
      mockClient.get.mockRejectedValueOnce({
        response: { status: 401, data: { msg: 'Invalid key' } },
      });

      await expect(connector.getAccountBalance('bad', 'bad')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateCredentials', () => {
    it('should return true when balance fetch succeeds', async () => {
      mockClient.get.mockResolvedValueOnce({
        data: { balances: [{ asset: 'USDT', free: '100', locked: '0' }] },
      });

      const result = await connector.validateCredentials('key', 'secret');
      expect(result).toBe(true);
    });

    it('should return false when balance fetch fails', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('fail'));
      const result = await connector.validateCredentials('bad', 'bad');
      expect(result).toBe(false);
    });
  });
});
