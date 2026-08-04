import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BrvmConnector } from './brvm.connector';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

describe('BrvmConnector', () => {
  let connector: BrvmConnector;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [BrvmConnector],
    }).compile();

    connector = moduleRef.get(BrvmConnector);
  });

  it('should be defined', () => {
    expect(connector).toBeDefined();
  });

  it('should have exchange name BRVM', () => {
    expect(connector.exchange).toBe(ExchangeName.BRVM);
  });

  describe('placeOrder', () => {
    it('should generate a manual ticket for a valid BRVM symbol', async () => {
      const result = await connector.placeOrder('', '', {
        symbol: 'ONTBF',
        side: 'BUY',
        type: 'MARKET',
        quantity: 100,
      });

      expect(result.status).toBe('MANUAL');
      expect(result.exchange).toBe(ExchangeName.BRVM);
      expect(result.orderId).toMatch(/^BRVM-\d+-\w+$/);
      expect(result.raw?.ticket).toContain('ACHAT');
      expect(result.raw?.ticket).toContain('ONTBF');
      expect(result.raw?.ticket).toContain('100');
      expect(result.raw?.brokerInstructions).toContain('broker');
    });

    it('should generate VENTE ticket for SELL', async () => {
      const result = await connector.placeOrder('', '', {
        symbol: 'SGBF',
        side: 'SELL',
        type: 'MARKET',
        quantity: 50,
      });

      expect(result.raw?.ticket).toContain('VENTE');
      expect(result.raw?.ticket).toContain('SGBF');
    });

    it('should throw BadRequestException for unsupported symbol', async () => {
      await expect(
        connector.placeOrder('', '', {
          symbol: 'UNKNOWN',
          side: 'BUY',
          type: 'MARKET',
          quantity: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should include price in ticket when provided', async () => {
      const result = await connector.placeOrder('', '', {
        symbol: 'BOABF',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 100,
        price: 12500,
      });

      expect(result.raw?.ticket).toContain('12500');
      expect(result.avgPrice).toBe('12500');
    });
  });

  describe('getAccountBalance', () => {
    it('should return zero balance in XOF', async () => {
      const result = await connector.getAccountBalance('', '');
      expect(result).toHaveLength(1);
      expect(result[0].asset).toBe('XOF');
      expect(result[0].free).toBe('0');
    });
  });

  describe('validateCredentials', () => {
    it('should always return true (no API for BRVM)', async () => {
      expect(await connector.validateCredentials('', '')).toBe(true);
    });
  });
});
