import { Test } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DerivConnector } from './deriv.connector';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DerivConnector', () => {
  let connector: DerivConnector;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DerivConnector,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    connector = moduleRef.get(DerivConnector);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(connector).toBeDefined();
  });

  it('should have exchange name DERIV', () => {
    expect(connector.exchange).toBe(ExchangeName.DERIV);
  });

  describe('placeOrder', () => {
    it('should place a CALL (BUY) order successfully', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { proposal: { id: 'prop-123' } } })
        .mockResolvedValueOnce({
          data: {
            buy: { contract_id: 999, buy_price: 10.5 },
          },
        });

      const result = await connector.placeOrder('token', '', {
        symbol: 'V75',
        side: 'BUY',
        type: 'MARKET',
        quantity: 10,
      });

      expect(result.orderId).toBe('999');
      expect(result.status).toBe('OPEN');
      expect(result.exchange).toBe(ExchangeName.DERIV);
    });

    it('should throw BadRequestException when no proposal ID returned', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { proposal: {} } });

      await expect(
        connector.placeOrder('token', '', {
          symbol: 'V75',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on unsupported symbol', async () => {
      await expect(
        connector.placeOrder('token', '', {
          symbol: 'UNKNOWN',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on timeout', async () => {
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });

      await expect(
        connector.placeOrder('token', '', {
          symbol: 'V75',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ServiceUnavailableException on rate limit', async () => {
      mockedAxios.post.mockRejectedValueOnce({ response: { status: 429 } });

      await expect(
        connector.placeOrder('token', '', {
          symbol: 'V75',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getAccountBalance', () => {
    it('should return balance array', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { balance: { balance: 500, currency: 'USD' } },
      });

      const result = await connector.getAccountBalance('token', '');
      expect(result).toHaveLength(1);
      expect(result[0].asset).toBe('USD');
      expect(result[0].free).toBe('500');
    });

    it('should throw BadRequestException when no balance returned', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: {} });

      await expect(connector.getAccountBalance('token', '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateCredentials', () => {
    it('should return true on successful balance fetch', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { balance: { balance: 100, currency: 'USD' } },
      });
      expect(await connector.validateCredentials('token', '')).toBe(true);
    });

    it('should return false on error', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('fail'));
      expect(await connector.validateCredentials('bad', '')).toBe(false);
    });
  });

  describe('symbol mapping', () => {
    it('should map V75 to R_75', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { proposal: { id: 'p1' } } })
        .mockResolvedValueOnce({ data: { buy: { contract_id: 1, buy_price: 5 } } });

      await connector.placeOrder('token', '', {
        symbol: 'V75',
        side: 'BUY',
        type: 'MARKET',
        quantity: 5,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.symbol).toBe('R_75');
    });

    it('should map EUR/USD to frxEURUSD', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ data: { proposal: { id: 'p1' } } })
        .mockResolvedValueOnce({ data: { buy: { contract_id: 1, buy_price: 5 } } });

      await connector.placeOrder('token', '', {
        symbol: 'EUR/USD',
        side: 'SELL',
        type: 'MARKET',
        quantity: 5,
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as any;
      expect(callBody.symbol).toBe('frxEURUSD');
      expect(callBody.contract_type).toBe('PUT');
    });
  });
});
