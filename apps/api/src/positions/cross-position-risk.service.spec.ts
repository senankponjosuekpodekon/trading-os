import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CrossPositionRiskService } from './cross-position-risk.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CrossPositionRiskService', () => {
  let service: CrossPositionRiskService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      position: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrossPositionRiskService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CrossPositionRiskService>(CrossPositionRiskService);
  });

  describe('checkCorrelationRisk', () => {
    it('returns when no open positions', async () => {
      prisma.position.findMany.mockResolvedValue([]);
      await expect(service.checkCorrelationRisk('pf1', 'BTC/USDT', 'BUY')).resolves.toBeUndefined();
    });

    it('throws when too many same cluster same direction', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'ETH/USDT' } },
        { id: 'p2', direction: 'BUY', asset: { symbol: 'SOL/USDT' } },
        { id: 'p3', direction: 'BUY', asset: { symbol: 'BNB/USDT' } },
      ]);
      await expect(service.checkCorrelationRisk('pf1', 'BTC/USDT', 'BUY')).rejects.toThrow(BadRequestException);
    });

    it('throws when too many same cluster total', async () => {
      const cluster = [
        { id: 'p1', direction: 'BUY', asset: { symbol: 'ETH/USDT' } },
        { id: 'p2', direction: 'SELL', asset: { symbol: 'SOL/USDT' } },
        { id: 'p3', direction: 'BUY', asset: { symbol: 'BNB/USDT' } },
        { id: 'p4', direction: 'SELL', asset: { symbol: 'ADA/USDT' } },
        { id: 'p5', direction: 'BUY', asset: { symbol: 'AVAX/USDT' } },
      ];
      prisma.position.findMany.mockResolvedValue(cluster);
      await expect(service.checkCorrelationRisk('pf1', 'BTC/USDT', 'SELL')).rejects.toThrow(BadRequestException);
    });

    it('passes when under limits', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'ETH/USDT' } },
      ]);
      await expect(service.checkCorrelationRisk('pf1', 'BTC/USDT', 'BUY')).resolves.toBeUndefined();
    });

    it('classifies synthetic symbols', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'V75' } },
      ]);
      await expect(service.checkCorrelationRisk('pf1', 'V100', 'BUY')).resolves.toBeUndefined();
    });

    it('classifies boom/crash symbols', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'BOOM1000' } },
      ]);
      await expect(service.checkCorrelationRisk('pf1', 'CRASH1000', 'SELL')).resolves.toBeUndefined();
    });

    it('classifies unknown symbols', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'UNKNOWN' } },
      ]);
      await expect(service.checkCorrelationRisk('pf1', 'XYZ/USD', 'BUY')).resolves.toBeUndefined();
    });

    it('warns when opposite direction >= 2 but does not throw', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'SELL', asset: { symbol: 'ETH/USDT' } },
        { id: 'p2', direction: 'SELL', asset: { symbol: 'SOL/USDT' } },
      ]);
      await expect(service.checkCorrelationRisk('pf1', 'BTC/USDT', 'BUY')).resolves.toBeUndefined();
    });
  });

  describe('getCorrelationReport', () => {
    it('returns low risk with one position', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'BTC/USDT', name: 'Bitcoin' } },
      ]);
      const result = await service.getCorrelationReport('pf1');
      expect(result.totalPositions).toBe(1);
      expect(result.overallRisk).toBe('LOW');
      expect(result.clusters['CRYPTO_MAJOR']).toBeDefined();
    });

    it('returns high risk at cluster direction limit', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'BTC/USDT', name: 'Bitcoin' } },
        { id: 'p2', direction: 'BUY', asset: { symbol: 'ETH/USDT', name: 'Ethereum' } },
        { id: 'p3', direction: 'BUY', asset: { symbol: 'SOL/USDT', name: 'Solana' } },
      ]);
      const result = await service.getCorrelationReport('pf1');
      expect(result.overallRisk).toBe('HIGH');
    });

    it('returns medium risk with 2 in cluster', async () => {
      prisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', asset: { symbol: 'BTC/USDT', name: 'Bitcoin' } },
        { id: 'p2', direction: 'SELL', asset: { symbol: 'ETH/USDT', name: 'Ethereum' } },
      ]);
      const result = await service.getCorrelationReport('pf1');
      expect(result.overallRisk).toBe('MEDIUM');
    });
  });
});
