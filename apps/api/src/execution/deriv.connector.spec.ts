import { Test } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DerivConnector } from './deriv.connector';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Nouvelle API Deriv (api.derivws.com) :
 * OTP REST → URL WS scopée compte → proposal → buy(proposal_id).
 * apiKey = Bearer token, apiSecret = account ID, DERIV_APP_ID = env.
 */
describe('DerivConnector', () => {
  let connector: DerivConnector;

  const OTP_RESPONSE = {
    data: { data: { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=abc' } },
  };

  /** Mock le transport WS : roundtrip renvoie les réponses en file. */
  function mockWsRoundtrip(...responses: any[]) {
    const rt = jest.spyOn(connector as any, 'wsRoundtrip');
    for (const r of responses) rt.mockResolvedValueOnce(r);
    jest
      .spyOn(connector as any, 'withTradingWs')
      .mockImplementation((_k: string, _s: string, fn: (ws: any) => Promise<any>) => fn({}));
    return rt;
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DerivConnector,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string, d?: any) => (k === 'DERIV_APP_ID' ? 'test-app-id' : d)),
          },
        },
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
    it('should place a CALL (BUY) order via proposal→buy', async () => {
      const rt = mockWsRoundtrip(
        { proposal: { id: 'prop-123' } },
        { buy: { contract_id: 999, buy_price: 10.5 } },
      );

      const result = await connector.placeOrder('token', 'acc-1', {
        symbol: 'V75',
        side: 'BUY',
        type: 'MARKET',
        quantity: 10,
      });

      expect(result.orderId).toBe('999');
      expect(result.status).toBe('OPEN');
      expect(result.exchange).toBe(ExchangeName.DERIV);
      // proposal utilise underlying_symbol (nouveau schéma)
      expect((rt.mock.calls[0][1] as any).underlying_symbol).toBe('R_75');
      expect((rt.mock.calls[0][1] as any).contract_type).toBe('CALL');
      // buy par proposal id
      expect((rt.mock.calls[1][1] as any)).toEqual({ buy: 'prop-123', price: 10 });
    });

    it('should throw BadRequestException when proposal errors', async () => {
      mockWsRoundtrip({ error: { message: 'Market is closed' } });

      await expect(
        connector.placeOrder('token', 'acc-1', {
          symbol: 'V75',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no proposal ID returned', async () => {
      mockWsRoundtrip({ proposal: {} });

      await expect(
        connector.placeOrder('token', 'acc-1', {
          symbol: 'V75',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on unsupported symbol', async () => {
      await expect(
        connector.placeOrder('token', 'acc-1', {
          symbol: 'UNKNOWN',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on OTP timeout', async () => {
      mockedAxios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });

      await expect(
        connector.placeOrder('token', 'acc-1', {
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
      mockWsRoundtrip({ balance: { balance: 500, currency: 'USD' } });

      const result = await connector.getAccountBalance('token', 'acc-1');
      expect(result).toHaveLength(1);
      expect(result[0].asset).toBe('USD');
      expect(result[0].free).toBe('500');
    });

    it('should throw BadRequestException when no balance returned', async () => {
      mockWsRoundtrip({ balance: null });

      await expect(connector.getAccountBalance('token', 'acc-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateCredentials', () => {
    it('should return true when OTP succeeds', async () => {
      mockedAxios.post.mockResolvedValueOnce(OTP_RESPONSE);
      expect(await connector.validateCredentials('token', 'acc-1')).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/trading/v1/options/accounts/acc-1/otp'),
        {},
        expect.objectContaining({
          headers: expect.objectContaining({
            'Deriv-App-ID': 'test-app-id',
            Authorization: 'Bearer token',
          }),
        }),
      );
    });

    it('should return false on error', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('fail'));
      expect(await connector.validateCredentials('bad', 'acc-1')).toBe(false);
    });
  });

  describe('symbol mapping', () => {
    it('should map BOOM300 to BOOM300N', async () => {
      const rt = mockWsRoundtrip(
        { proposal: { id: 'p1' } },
        { buy: { contract_id: 1, buy_price: 5 } },
      );

      await connector.placeOrder('token', 'acc-1', {
        symbol: 'BOOM300',
        side: 'BUY',
        type: 'MARKET',
        quantity: 5,
      });

      expect((rt.mock.calls[0][1] as any).underlying_symbol).toBe('BOOM300N');
    });

    it('should map EUR/USD to frxEURUSD and SELL to PUT', async () => {
      const rt = mockWsRoundtrip(
        { proposal: { id: 'p1' } },
        { buy: { contract_id: 1, buy_price: 5 } },
      );

      await connector.placeOrder('token', 'acc-1', {
        symbol: 'EUR/USD',
        side: 'SELL',
        type: 'MARKET',
        quantity: 5,
      });

      expect((rt.mock.calls[0][1] as any).underlying_symbol).toBe('frxEURUSD');
      expect((rt.mock.calls[0][1] as any).contract_type).toBe('PUT');
    });
  });
});
