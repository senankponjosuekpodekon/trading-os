import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { SignalFeatures } from './signal-predictor.service';
import { PatternPredictorService, PatternFeaturesInput } from './pattern-predictor.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EngineKeyGuard } from '../auth/engine-key.guard';

@Controller('signals')
export class SignalsController {
  constructor(
    private signalsService: SignalsService,
    private outcomeService: SignalOutcomeService,
    private patternPredictorService: PatternPredictorService,
    private engine: EngineHttpService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('profile') profile?: string,
    @Query('market') market?: string,
    @Query('risk_level') riskLevel?: string,
  ) {
    return this.signalsService.findAll({
      page:    page   ? Math.max(1, parseInt(page, 10))   : 1,
      limit:   limit  ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
      sort:    sort   || 'createdAt:desc',
      profile: profile,
      market:  market,
      riskLevel: riskLevel,
    });
  }

  @Post('scan')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  triggerScan(
    @Request() req: any,
    @Body() body: { symbols: string[]; timeframe?: string; strategies?: any[] },
  ) {
    return this.signalsService.triggerScan(body.symbols, body.timeframe ?? '1h', {
      userId: req.user.id,
      strategies: body.strategies,
    });
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  getStats(@Query('market') market?: string) {
    return this.outcomeService.getStats(market);
  }

  @Get('alerts/stats')
  @UseGuards(JwtAuthGuard)
  getAlertStats(@Request() req: any) {
    return this.signalsService.getAlertStats(req.user.id);
  }

  @Get('calibration')
  @UseGuards(JwtAuthGuard)
  getCalibration(
    @Query('market') market?: string,
    @Query('signalType') signalType?: string,
  ) {
    return this.outcomeService.getConfidenceCalibration(market, signalType);
  }

  @Get('predict-win-rate')
  @UseGuards(JwtAuthGuard)
  predictWinRate(
    @Query('confidence') confidence: string,
    @Query('market') market?: string,
    @Query('signalType') signalType?: string,
  ) {
    const c = parseFloat(confidence);
    if (Number.isNaN(c)) return { error: 'confidence must be a number' };
    return this.outcomeService.predictWinRate(c, market, signalType);
  }

  @Post('predictor/train')
  @UseGuards(JwtAuthGuard)
  trainPredictor(
    @Query('market') market?: string,
    @Query('timeframe') timeframe?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.max(100, Math.min(5000, parseInt(limit, 10))) : undefined;
    return this.signalsService.trainPredictor({ market, timeframe, limit: parsedLimit });
  }

  @Post('predictor/predict')
  @UseGuards(JwtAuthGuard)
  predictSignal(@Body() features: SignalFeatures) {
    return this.signalsService.predictSignalScore(features);
  }

  @Get('predictor/status')
  @UseGuards(JwtAuthGuard)
  predictorStatus() {
    return this.signalsService.getPredictorStatus();
  }

  @Get('predictor/weights')
  @UseGuards(JwtAuthGuard)
  predictorWeights() {
    return this.signalsService.getPredictorFeatureWeights();
  }

  @Post('memory/similar')
  @UseGuards(JwtAuthGuard)
  findSimilarSignals(@Body() dto: any) {
    return this.outcomeService.findSimilar(dto);
  }

  @Get('pattern-stats')
  @UseGuards(JwtAuthGuard)
  getPatternStats() {
    return this.outcomeService.getPatternStats();
  }

  @Get('features')
  @UseGuards(JwtAuthGuard)
  listFeatureSnapshots(
    @Query('market') market?: string,
    @Query('outcome') outcome?: string,
    @Query('timeframe') timeframe?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.signalsService.listFeatureSnapshots({
      market,
      outcome,
      timeframe,
      limit: parsedLimit,
    });
  }

  @Get('features/export')
  @UseGuards(JwtAuthGuard)
  exportFeatureSnapshots(
    @Query('market') market?: string,
    @Query('outcome') outcome?: string,
    @Query('timeframe') timeframe?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.signalsService.exportFeatureDataset({
      market,
      outcome,
      timeframe,
      limit: parsedLimit ?? 500,
    });
  }

  @Get('post-trade-analysis')
  @UseGuards(JwtAuthGuard)
  getPostTradeAnalysis(
    @Query('market') market?: string,
    @Query('patternName') patternName?: string,
  ) {
    return this.outcomeService.getPostTradeAnalysis(market, patternName);
  }

  @Post('pattern-predictor/train')
  @UseGuards(JwtAuthGuard)
  trainPatternPredictor(@Query('market') market?: string) {
    return this.patternPredictorService.train(market);
  }

  @Post('pattern-predictor/predict')
  @UseGuards(JwtAuthGuard)
  predictPattern(@Body() features: PatternFeaturesInput) {
    return this.patternPredictorService.predict(features);
  }

  @Get('pattern-predictor/status')
  @UseGuards(JwtAuthGuard)
  patternPredictorStatus() {
    return this.patternPredictorService.getStatus();
  }

  @Post('ingest')
  @UseGuards(EngineKeyGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async ingestSignal(@Body() body: any) {
    return this.signalsService.ingestSignal(body);
  }

  @Get('scan-history')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async scanHistory(
    @Query('limit') limit?: string,
    @Query('strategy') strategy?: string,
    @Query('signal') signal?: string,
  ) {
    const lim = limit ? Math.min(200, Math.max(1, parseInt(limit, 10))) : 50;
    const params: Record<string, any> = { limit: lim };
    if (strategy) params.strategy = strategy;
    if (signal) params.signal = signal;
    return this.engine.get('/scan/history', { params });
  }

  @Get('scan-history/db')
  @UseGuards(JwtAuthGuard)
  async scanHistoryDb(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('strategyId') strategyId?: string,
    @Query('strategyName') strategyName?: string,
    @Query('symbol') symbol?: string,
    @Query('signal') signal?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.signalsService.findScanHistory({
      page: page ? Math.max(1, parseInt(page, 10)) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
      strategyId,
      strategyName,
      symbol,
      signal,
      timeframe,
    });
  }
}
