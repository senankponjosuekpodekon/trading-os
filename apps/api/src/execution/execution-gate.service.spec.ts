import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionGateService } from './execution-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrossPositionRiskService } from '../positions/cross-position-risk.service';

describe('ExecutionGateService', () => {
  let service: ExecutionGateService;

  const mockPrisma = {
    position: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    signal: {
      findUnique: jest.fn(),
    },
  };

  const mockCrossRisk = {
    checkCorrelationRisk: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionGateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CrossPositionRiskService, useValue: mockCrossRisk },
      ],
    }).compile();
    service = module.get(ExecutionGateService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── validateExecutionGate ──────────────────────────────────────────
  describe('validateExecutionGate', () => {
    const baseSignal = {
      id: 'sig-1',
      signal: 'BUY',
      entryPrice: 100,
      stopLoss: 95,
      takeProfit1: 110,
      expiresAt: null,
      asset: { symbol: 'BTC/USDT' },
      timeframe: '5m',
    };

    it('rejects expired signal', () => {
      const sig = { ...baseSignal, expiresAt: new Date(Date.now() - 60000).toISOString() };
      const result = service.validateExecutionGate(sig, 100, 'PAPER');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('skips when missing entry/SL/TP', () => {
      const sig = { ...baseSignal, entryPrice: null, stopLoss: null, takeProfit1: null };
      const result = service.validateExecutionGate(sig as any, 100, 'PAPER');
      expect(result.ok).toBe(true);
    });

    it('rejects BUY when price above entry zone', () => {
      const result = service.validateExecutionGate(baseSignal, 120, 'PAPER');
      expect(result.ok).toBe(false);
    });

    it('rejects SELL when price below entry zone', () => {
      const sellSignal = { ...baseSignal, signal: 'SELL', stopLoss: 105, takeProfit1: 90 };
      const result = service.validateExecutionGate(sellSignal, 80, 'PAPER');
      expect(result.ok).toBe(false);
    });

    it('accepts BUY when price within entry zone', () => {
      const result = service.validateExecutionGate(baseSignal, 100, 'PAPER');
      expect(result.ok).toBe(true);
    });

    it('rejects when R:R below minimum block', () => {
      const sig = { ...baseSignal, stopLoss: 99, takeProfit1: 100.5 };
      const result = service.validateExecutionGate(sig, 100, 'PAPER');
      expect(result.ok).toBe(false);
    });

    it('accepts with good R:R', () => {
      const result = service.validateExecutionGate(baseSignal, 100, 'PAPER');
      expect(result.ok).toBe(true);
    });
  });

  // ── validateSignalExecution ────────────────────────────────────────
  describe('validateSignalExecution', () => {
    const baseSignal = {
      id: 'sig-1',
      signal: 'BUY',
      entryPrice: 100,
      stopLoss: 95,
      takeProfit1: 110,
      expiresAt: null,
      asset: { symbol: 'BTC/USDT' },
      timeframe: '5m',
      status: 'ACTIVE',
    };

    it('rejects when signal not found', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue(null);
      await expect(service.validateSignalExecution('missing', 'port-1', 100, 'PAPER'))
        .rejects.toThrow();
    });

    it('rejects duplicate position', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue(baseSignal);
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'pos-1' });
      await expect(service.validateSignalExecution('sig-1', 'port-1', 100, 'PAPER'))
        .rejects.toThrow('DUPLICATE_POSITION');
    });

    it('accepts valid signal with no duplicate', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue(baseSignal);
      mockPrisma.position.findFirst.mockResolvedValue(null);
      mockPrisma.position.count.mockResolvedValue(0);
      mockCrossRisk.checkCorrelationRisk.mockResolvedValue(undefined);
      const result = await service.validateSignalExecution('sig-1', 'port-1', 100, 'PAPER');
      expect(result.signal).toBeTruthy();
      expect(result.gateResult.ok).toBe(true);
    });
  });
});
