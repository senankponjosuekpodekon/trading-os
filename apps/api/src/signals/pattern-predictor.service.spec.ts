import { Test, TestingModule } from '@nestjs/testing';
import { PatternPredictorService } from './pattern-predictor.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PatternPredictorService', () => {
  let service: PatternPredictorService;

  const mockPrisma = {
    signalLog: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatternPredictorService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PatternPredictorService>(PatternPredictorService);
    jest.clearAllMocks();
  });

  it('should refuse training with too few samples', async () => {
    mockPrisma.signalLog.findMany.mockResolvedValue([]);
    const result = await service.train();
    expect(result.trained).toBe(false);
    expect(result.reason).toBe('too few samples');
  });

  it('should train and predict a pattern outcome', async () => {
    mockPrisma.signalLog.findMany.mockResolvedValue([
      { patternName: 'abcd', patternConfluenceScore: 0.9, scoreTotal: 80, adx: 30, riskReward: 2, signalType: 'BUY', outcome: 'WIN_TP1' },
      { patternName: 'abcd', patternConfluenceScore: 0.8, scoreTotal: 75, adx: 25, riskReward: 2, signalType: 'BUY', outcome: 'WIN_TP2' },
      { patternName: 'abcd', patternConfluenceScore: 0.5, scoreTotal: 60, adx: 20, riskReward: 1.5, signalType: 'BUY', outcome: 'LOSS_SL' },
      { patternName: 'double_top', patternConfluenceScore: 0.7, scoreTotal: 70, adx: 28, riskReward: 2, signalType: 'SELL', outcome: 'WIN_TP1' },
      { patternName: 'double_top', patternConfluenceScore: 0.4, scoreTotal: 55, adx: 18, riskReward: 1.5, signalType: 'SELL', outcome: 'LOSS_SL' },
      { patternName: 'double_top', patternConfluenceScore: 0.6, scoreTotal: 65, adx: 22, riskReward: 1.8, signalType: 'SELL', outcome: 'WIN_TP1' },
      { patternName: 'abcd', patternConfluenceScore: 0.3, scoreTotal: 50, adx: 15, riskReward: 1.2, signalType: 'BUY', outcome: 'LOSS_SL' },
      { patternName: 'abcd', patternConfluenceScore: 0.85, scoreTotal: 78, adx: 32, riskReward: 2.2, signalType: 'BUY', outcome: 'WIN_TP1' },
      { patternName: 'double_top', patternConfluenceScore: 0.65, scoreTotal: 68, adx: 26, riskReward: 2, signalType: 'SELL', outcome: 'WIN_TP2' },
      { patternName: 'double_top', patternConfluenceScore: 0.45, scoreTotal: 58, adx: 19, riskReward: 1.4, signalType: 'SELL', outcome: 'LOSS_SL' },
    ]);

    const trainResult = await service.train();
    expect(trainResult.trained).toBe(true);
    expect(trainResult.count).toBe(10);

    const prediction = service.predict({
      patternName: 'abcd',
      patternConfluenceScore: 0.9,
      scoreTotal: 85,
      adx: 35,
      riskReward: 2.5,
      signalType: 'BUY',
    });

    expect(Number.isNaN(prediction.probability)).toBe(false);
    expect(prediction.probability).toBeGreaterThan(0);
    expect(prediction.probability).toBeLessThan(1);
    expect(prediction.featuresUsed).toContain('pattern_abcd');
  });

  it('should return NaN probability if not trained', () => {
    const prediction = service.predict({ patternName: 'abcd', patternConfluenceScore: 0.8 });
    expect(Number.isNaN(prediction.probability)).toBe(true);
  });
});
