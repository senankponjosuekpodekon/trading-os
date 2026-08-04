import { Test } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OandaConnector } from './oanda.connector';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OandaConnector', () => {
  let connector: OandaConnector;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OandaConnector,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'OANDA_USE_PRACTICE') return 'true';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    connector = moduleRef.get(OandaConnector);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(connector).toBeDefined();
  });

  it('should have exchange name OANDA', () => {
    expect(connector.exchange).toBe(ExchangeName.OANDA);
  });

  it('should use practice URL when OANDA_USE_PRACTICE=true', () => {
    expect((connector as any).baseUrl).toBe('https://api-fxpractice.oanda.com');
  });

  describe('placeOrder', () => {
    it('should place a market order successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          orderFillTransaction: {
            orderID: 'ABC123',
            units: '100',
            price: '1.0850',
            type: 'ORDER_FILL',
          },
        },
      });

      const result = await connector.placeOrder('token', '001-001-123-001', {
        symbol: 'EUR/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 100,
      });

      expect(result.orderId).toBe('ABC123');
      expect(result.status).toBe('FILLED');
      expect(result.exchange).toBe(ExchangeName.OANDA);
      expect(result.executedQty).toBe('100');
    });

    it('should throw BadRequestException when account ID is missing', async () => {
      await expect(
        connector.placeOrder('token', '', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for unsupported symbol', async () => {
      await expect(
        connector.placeOrder('token', '001-001-123-001', {
          symbol: 'UNKNOWN/PAIR',
          side: 'BUY',
          type: 'MARKET',
          quantity: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on timeout', async () => {
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });

      await expect(
        connector.placeOrder('token', '001-001-123-001', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 100,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw BadRequestException on 401 (invalid token)', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 401, data: { errorMessage: 'Unauthorized' } },
      });

      await expect(
        connector.placeOrder('bad', '001-001-123-001', {
          symbol: 'EUR/USD',
          side: 'BUY',
          type: 'MARKET',
          quantity: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should convert SELL to negative units', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          orderFillTransaction: {
            orderID: 'XYZ',
            units: '-100',
            price: '1.0850',
            type: 'ORDER_FILL',
          },
        },
      });

      await connector.placeOrder('token', '001-001-123-001', {
        symbol: 'EUR/USD',
        side: 'SELL',
        type: 'MARKET',
        quantity: 100,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.order.units).toBe('-100');
    });
  });

  describe('getAccountBalance', () => {
    it('should return balance array', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          account: { balance: '5000', currency: 'USD', NAV: '5000' },
        },
      });

      const result = await connector.getAccountBalance('token', '001-001-123-001');
      expect(result).toHaveLength(1);
      expect(result[0].asset).toBe('USD');
      expect(result[0].free).toBe('5000');
    });

    it('should throw BadRequestException when account ID is missing', async () => {
      await expect(connector.getAccountBalance('token', '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateCredentials', () => {
    it('should return true when account matches', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { account: { id: '001-001-123-001' } },
      });
      expect(await connector.validateCredentials('token', '001-001-123-001')).toBe(true);
    });

    it('should return false on error', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('fail'));
      expect(await connector.validateCredentials('bad', 'bad')).toBe(false);
    });

    it('should return false when account ID is too short', async () => {
      expect(await connector.validateCredentials('token', 'ab')).toBe(false);
    });
  });

  describe('symbol mapping', () => {
    it('should map XAU/USD to XAU_USD', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          orderFillTransaction: {
            orderID: '1', units: '10', price: '2000', type: 'ORDER_FILL',
          },
        },
      });

      await connector.placeOrder('token', '001-001-123-001', {
        symbol: 'XAU/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 10,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.order.instrument).toBe('XAU_USD');
    });

    it('should accept raw OANDA format (EUR_USD)', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          orderFillTransaction: {
            orderID: '1', units: '10', price: '1.08', type: 'ORDER_FILL',
          },
        },
      });

      await connector.placeOrder('token', '001-001-123-001', {
        symbol: 'GBP_USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 10,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.order.instrument).toBe('GBP_USD');
    });
  });
});
