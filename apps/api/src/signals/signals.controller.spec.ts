import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { PatternPredictorService } from './pattern-predictor.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EngineKeyGuard } from '../auth/engine-key.guard';

describe('SignalsController', () => {
  let controller: SignalsController;

  const mockSignalsService = {
    findAll: jest.fn(),
    triggerScan: jest.fn(),
    getAlertStats: jest.fn(),
    trainPredictor: jest.fn(),
    predictSignalScore: jest.fn(),
    getPredictorStatus: jest.fn(),
    getPredictorFeatureWeights: jest.fn(),
    listFeatureSnapshots: jest.fn(),
    exportFeatureDataset: jest.fn(),
    ingestSignal: jest.fn(),
    findScanHistory: jest.fn(),
  };

  const mockOutcomeService = {
    getStats: jest.fn(),
    getConfidenceCalibration: jest.fn(),
    predictWinRate: jest.fn(),
    findSimilar: jest.fn(),
    getPatternStats: jest.fn(),
    getPostTradeAnalysis: jest.fn(),
  };

  const mockPatternPredictorService = {
    train: jest.fn(),
    predict: jest.fn(),
    getStatus: jest.fn(),
  };

  const mockEngine = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [SignalsController],
      providers: [
        { provide: SignalsService, useValue: mockSignalsService },
        { provide: SignalOutcomeService, useValue: mockOutcomeService },
        { provide: PatternPredictorService, useValue: mockPatternPredictorService },
        { provide: EngineHttpService, useValue: mockEngine },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (): boolean => true } as CanActivate)
      .overrideGuard(EngineKeyGuard)
      .useValue({ canActivate: (): boolean => true } as CanActivate)
      .compile();

    controller = module.get<SignalsController>(SignalsController);
  });

  it('findAll forwards query', async () => {
    mockSignalsService.findAll.mockResolvedValue({ items: [] });
    const result = await controller.findAll('2', '50', 'score:asc', 'SWING', 'CRYPTO', 'LOW');
    expect(mockSignalsService.findAll).toHaveBeenCalledWith({
      page: 2, limit: 50, sort: 'score:asc', profile: 'SWING', market: 'CRYPTO', riskLevel: 'LOW',
    });
    expect(result).toEqual({ items: [] });
  });

  it('triggerScan', async () => {
    mockSignalsService.triggerScan.mockResolvedValue({ started: true });
    const result = await controller.triggerScan({ user: { id: 'u1' } }, { symbols: ['BTC/USDT'], timeframe: '4h', strategies: [] });
    expect(mockSignalsService.triggerScan).toHaveBeenCalledWith(['BTC/USDT'], '4h', { userId: 'u1', strategies: [] });
    expect(result).toEqual({ started: true });
  });

  it('getStats', async () => {
    mockOutcomeService.getStats.mockResolvedValue({ win: 5 });
    const result = await controller.getStats('CRYPTO');
    expect(mockOutcomeService.getStats).toHaveBeenCalledWith('CRYPTO');
    expect(result).toEqual({ win: 5 });
  });

  it('getAlertStats', async () => {
    mockSignalsService.getAlertStats.mockResolvedValue({ count: 1 });
    const result = await controller.getAlertStats({ user: { id: 'u1' } });
    expect(mockSignalsService.getAlertStats).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ count: 1 });
  });

  it('getCalibration', async () => {
    mockOutcomeService.getConfidenceCalibration.mockResolvedValue({ bins: [] });
    const result = await controller.getCalibration('CRYPTO', 'BREAKOUT');
    expect(mockOutcomeService.getConfidenceCalibration).toHaveBeenCalledWith('CRYPTO', 'BREAKOUT');
    expect(result).toEqual({ bins: [] });
  });

  it('predictWinRate with number', async () => {
    mockOutcomeService.predictWinRate.mockResolvedValue({ rate: 0.6 });
    const result = await controller.predictWinRate('75', 'CRYPTO', 'BREAKOUT');
    expect(mockOutcomeService.predictWinRate).toHaveBeenCalledWith(75, 'CRYPTO', 'BREAKOUT');
    expect(result).toEqual({ rate: 0.6 });
  });

  it('predictWinRate rejects non-number', async () => {
    const result = await controller.predictWinRate('foo', 'CRYPTO', 'BREAKOUT');
    expect(result).toEqual({ error: 'confidence must be a number' });
  });

  it('trainPredictor', async () => {
    mockSignalsService.trainPredictor.mockResolvedValue({ trained: true });
    const result = await controller.trainPredictor('CRYPTO', '1h', '500');
    expect(mockSignalsService.trainPredictor).toHaveBeenCalledWith({ market: 'CRYPTO', timeframe: '1h', limit: 500 });
    expect(result).toEqual({ trained: true });
  });

  it('predictSignal', async () => {
    mockSignalsService.predictSignalScore.mockResolvedValue({ score: 80 });
    const result = await controller.predictSignal({ confidence: 75 } as any);
    expect(mockSignalsService.predictSignalScore).toHaveBeenCalledWith({ confidence: 75 });
    expect(result).toEqual({ score: 80 });
  });

  it('predictorStatus', async () => {
    mockSignalsService.getPredictorStatus.mockResolvedValue({ ok: true });
    const result = await controller.predictorStatus();
    expect(mockSignalsService.getPredictorStatus).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('predictorWeights', async () => {
    mockSignalsService.getPredictorFeatureWeights.mockResolvedValue({ weights: [] });
    const result = await controller.predictorWeights();
    expect(mockSignalsService.getPredictorFeatureWeights).toHaveBeenCalled();
    expect(result).toEqual({ weights: [] });
  });

  it('findSimilarSignals', async () => {
    mockOutcomeService.findSimilar.mockResolvedValue({ similar: [] });
    const result = await controller.findSimilarSignals({ features: {} });
    expect(mockOutcomeService.findSimilar).toHaveBeenCalledWith({ features: {} });
    expect(result).toEqual({ similar: [] });
  });

  it('getPatternStats', async () => {
    mockOutcomeService.getPatternStats.mockResolvedValue({ patterns: [] });
    const result = await controller.getPatternStats();
    expect(mockOutcomeService.getPatternStats).toHaveBeenCalled();
    expect(result).toEqual({ patterns: [] });
  });

  it('listFeatureSnapshots', async () => {
    mockSignalsService.listFeatureSnapshots.mockResolvedValue({ rows: [] });
    const result = await controller.listFeatureSnapshots('CRYPTO', 'WIN', '1h', '100');
    expect(mockSignalsService.listFeatureSnapshots).toHaveBeenCalledWith({
      market: 'CRYPTO', outcome: 'WIN', timeframe: '1h', limit: 100,
    });
    expect(result).toEqual({ rows: [] });
  });

  it('exportFeatureSnapshots', async () => {
    mockSignalsService.exportFeatureDataset.mockResolvedValue({ csv: 'a' });
    const result = await controller.exportFeatureSnapshots('CRYPTO', 'WIN', '1h', '50');
    expect(mockSignalsService.exportFeatureDataset).toHaveBeenCalledWith({
      market: 'CRYPTO', outcome: 'WIN', timeframe: '1h', limit: 50,
    });
    expect(result).toEqual({ csv: 'a' });
  });

  it('exportFeatureSnapshots default limit', async () => {
    mockSignalsService.exportFeatureDataset.mockResolvedValue({ csv: 'b' });
    const result = await controller.exportFeatureSnapshots('CRYPTO', undefined, undefined, undefined);
    expect(mockSignalsService.exportFeatureDataset).toHaveBeenCalledWith({
      market: 'CRYPTO', outcome: undefined, timeframe: undefined, limit: 500,
    });
    expect(result).toEqual({ csv: 'b' });
  });

  it('getPostTradeAnalysis', async () => {
    mockOutcomeService.getPostTradeAnalysis.mockResolvedValue({});
    const result = await controller.getPostTradeAnalysis('CRYPTO', 'DoubleTop');
    expect(mockOutcomeService.getPostTradeAnalysis).toHaveBeenCalledWith('CRYPTO', 'DoubleTop');
    expect(result).toEqual({});
  });

  it('trainPatternPredictor', async () => {
    mockPatternPredictorService.train.mockResolvedValue({ trained: true });
    const result = await controller.trainPatternPredictor('CRYPTO');
    expect(mockPatternPredictorService.train).toHaveBeenCalledWith('CRYPTO');
    expect(result).toEqual({ trained: true });
  });

  it('predictPattern', async () => {
    mockPatternPredictorService.predict.mockResolvedValue({ prediction: 'up' });
    const result = await controller.predictPattern({ features: [] } as any);
    expect(mockPatternPredictorService.predict).toHaveBeenCalledWith({ features: [] });
    expect(result).toEqual({ prediction: 'up' });
  });

  it('patternPredictorStatus', async () => {
    mockPatternPredictorService.getStatus.mockResolvedValue({ ok: true });
    const result = await controller.patternPredictorStatus();
    expect(mockPatternPredictorService.getStatus).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('ingestSignal', async () => {
    mockSignalsService.ingestSignal.mockResolvedValue({ id: 's1' });
    const result = await controller.ingestSignal({ signal: 'BUY' });
    expect(mockSignalsService.ingestSignal).toHaveBeenCalledWith({ signal: 'BUY' });
    expect(result).toEqual({ id: 's1' });
  });

  it('scanHistory', async () => {
    mockEngine.get.mockResolvedValue({ rows: [] });
    const result = await controller.scanHistory('100', 'strat1', 'BUY');
    expect(mockEngine.get).toHaveBeenCalledWith('/scan/history', { params: { limit: 100, strategy: 'strat1', signal: 'BUY' } });
    expect(result).toEqual({ rows: [] });
  });

  it('scanHistoryDb', async () => {
    mockSignalsService.findScanHistory.mockResolvedValue({ items: [] });
    const result = await controller.scanHistoryDb('2', '30', 'id1', 'name1', 'BTC/USDT', 'BUY', '1h');
    expect(mockSignalsService.findScanHistory).toHaveBeenCalledWith({
      page: 2, limit: 30, strategyId: 'id1', strategyName: 'name1', symbol: 'BTC/USDT', signal: 'BUY', timeframe: '1h',
    });
    expect(result).toEqual({ items: [] });
  });
});
