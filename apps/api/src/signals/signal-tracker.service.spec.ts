import { Test, TestingModule } from '@nestjs/testing';
import { SignalTrackerService } from './signal-tracker.service';
import { SignalExecutionService } from './signal-execution.service';
import { CandleRepository } from './candle.repository';
import { PrismaService } from '../prisma/prisma.service';
import { SignalExecutionEventType, SignalExecutionStatus } from '@prisma/client';

describe('SignalTrackerService', () => {
  let service: SignalTrackerService;
  let prisma: PrismaService;
  let candleRepo: CandleRepository;

  const mockPrisma = {
    signal: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    signalExecutionEvent: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  const mockCandleRepo = {
    getSince: jest.fn(),
    getLowerTimeframeWindow: jest.fn(),
  };

  const mockExecutionService = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalTrackerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'CandleRepository', useValue: mockCandleRepo },
        { provide: SignalExecutionService, useValue: mockExecutionService },
      ],
    }).compile();

    service = module.get<SignalTrackerService>(SignalTrackerService);
    prisma = module.get<PrismaService>(PrismaService);
    candleRepo = module.get<CandleRepository>('CandleRepository');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processActiveSignals', () => {
    it('should process PENDING and ACTIVE signals', async () => {
      const signals = [{ id: '1' }, { id: '2' }];
      mockPrisma.signal.findMany.mockResolvedValue(signals);
      mockPrisma.signal.findUniqueOrThrow.mockResolvedValue({
        id: '1',
        signal: 'BUY',
        entryPrice: 100,
        stopLoss: 90,
        takeProfit1: 110,
        executionStatus: 'PENDING',
        lastProcessedCandle: null,
        asset: { symbol: 'BTC/USDT' },
        timeframe: '1h',
        createdAt: new Date(),
        executionEvents: [],
      });
      mockCandleRepo.getSince.mockResolvedValue([]);

      await service.processActiveSignals();

      expect(mockPrisma.signal.findMany).toHaveBeenCalledWith({
        where: { executionStatus: { in: ['PENDING', 'ACTIVE'] } },
        select: { id: true },
        take: 200,
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('processSignal', () => {
    it('should detect ENTRY_HIT when candle touches entry', async () => {
      const signal = {
        id: '1',
        signal: 'BUY',
        entryPrice: 100,
        stopLoss: 90,
        takeProfit1: 110,
        executionStatus: 'PENDING',
        lastProcessedCandle: null,
        asset: { symbol: 'BTC/USDT' },
        timeframe: '1h',
        createdAt: new Date('2024-01-01'),
        executionEvents: [],
      };

      mockPrisma.signal.findUniqueOrThrow.mockResolvedValue(signal);
      mockCandleRepo.getSince.mockResolvedValue([
        { openTime: new Date('2024-01-01').getTime(), open: 95, high: 105, low: 95, close: 100 },
      ]);

      await service.processSignal('1');

      expect(mockPrisma.signalExecutionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signalId: '1',
            type: 'ENTRY_HIT',
            price: 100,
          }),
        })
      );
    });

    it('should detect SL_HIT when candle touches stop loss', async () => {
      const signal = {
        id: '1',
        signal: 'BUY',
        entryPrice: 100,
        stopLoss: 90,
        takeProfit1: 110,
        executionStatus: 'ACTIVE',
        lastProcessedCandle: new Date('2024-01-01'),
        currentStopLoss: 90,
        asset: { symbol: 'BTC/USDT' },
        timeframe: '1h',
        createdAt: new Date('2024-01-01'),
        executionEvents: [{ type: 'ENTRY_HIT' }],
      };

      mockPrisma.signal.findUniqueOrThrow.mockResolvedValue(signal);
      mockCandleRepo.getSince.mockResolvedValue([
        { openTime: new Date('2024-01-02').getTime(), open: 95, high: 100, low: 85, close: 90 },
      ]);

      await service.processSignal('1');

      expect(mockPrisma.signalExecutionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signalId: '1',
            type: 'SL_HIT',
            price: 90,
          }),
        })
      );
    });

    it('should detect TP1_HIT when candle touches take profit', async () => {
      const signal = {
        id: '1',
        signal: 'BUY',
        entryPrice: 100,
        stopLoss: 90,
        takeProfit1: 110,
        executionStatus: 'ACTIVE',
        lastProcessedCandle: new Date('2024-01-01'),
        currentStopLoss: 90,
        asset: { symbol: 'BTC/USDT' },
        timeframe: '1h',
        createdAt: new Date('2024-01-01'),
        executionEvents: [{ type: 'ENTRY_HIT' }],
      };

      mockPrisma.signal.findUniqueOrThrow.mockResolvedValue(signal);
      mockCandleRepo.getSince.mockResolvedValue([
        { openTime: new Date('2024-01-02').getTime(), open: 105, high: 115, low: 105, close: 110 },
      ]);

      await service.processSignal('1');

      expect(mockPrisma.signalExecutionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signalId: '1',
            type: 'TP1_HIT',
            price: 110,
          }),
        })
      );
    });

    it('should handle SL and TP in same candle with CONSERVATIVE_SL_FIRST', async () => {
      const signal = {
        id: '1',
        signal: 'BUY',
        entryPrice: 100,
        stopLoss: 90,
        takeProfit1: 110,
        executionStatus: 'ACTIVE',
        lastProcessedCandle: new Date('2024-01-01'),
        currentStopLoss: 90,
        asset: { symbol: 'BTC/USDT' },
        timeframe: '1h',
        createdAt: new Date('2024-01-01'),
        executionEvents: [{ type: 'ENTRY_HIT' }],
      };

      mockPrisma.signal.findUniqueOrThrow.mockResolvedValue(signal);
      mockCandleRepo.getSince.mockResolvedValue([
        { openTime: new Date('2024-01-02').getTime(), open: 95, high: 115, low: 85, close: 100 },
      ]);

      await service.processSignal('1');

      expect(mockPrisma.signalExecutionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signalId: '1',
            type: 'SL_HIT',
            resolvedBy: 'CONSERVATIVE_SL_FIRST',
          }),
        })
      );
    });

    it('should expire signal if expiresAt is passed', async () => {
      const signal = {
        id: '1',
        signal: 'BUY',
        entryPrice: 100,
        stopLoss: 90,
        takeProfit1: 110,
        executionStatus: 'PENDING',
        lastProcessedCandle: null,
        asset: { symbol: 'BTC/USDT' },
        timeframe: '1h',
        createdAt: new Date('2024-01-01'),
        expiresAt: new Date('2024-01-01'), // déjà expiré
        executionEvents: [],
      };

      mockPrisma.signal.findUniqueOrThrow.mockResolvedValue(signal);
      mockCandleRepo.getSince.mockResolvedValue([
        { openTime: new Date('2024-01-02').getTime(), open: 95, high: 105, low: 95, close: 100 },
      ]);

      await service.processSignal('1');

      expect(mockPrisma.signalExecutionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signalId: '1',
            type: 'EXPIRED',
          }),
        })
      );
    });
  });
});
