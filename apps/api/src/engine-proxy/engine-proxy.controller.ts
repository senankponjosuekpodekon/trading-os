import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EngineHttpService } from '../engine/engine-http.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class EngineProxyController {
  constructor(private engine: EngineHttpService) {}

  // ── BRVM ──────────────────────────────────────────────────────────
  @Post('brvm/scan')
  brvmScan(@Body() body: any) {
    return this.engine.post('/brvm/scan', body, { timeout: 30_000 });
  }

  @Get('brvm/top-movers')
  brvmMovers() {
    return this.engine.get('/brvm/top-movers');
  }

  @Post('brvm/reports/scores')
  brvmScores(@Body() body: any) {
    return this.engine.post('/brvm/reports/scores', body, { timeout: 30_000 });
  }

  @Get('brvm/reports/issuers')
  brvmIssuers() {
    return this.engine.get('/brvm/reports/issuers');
  }

  @Get('brvm/health')
  brvmHealth() {
    return this.engine.get('/brvm/health', { timeout: 5_000 });
  }

  @Get('brvm/quotes')
  brvmQuotes() {
    return this.engine.get('/brvm/quotes');
  }

  @Get('brvm/reports/symbol/:symbol')
  brvmReportBySymbol(@Param('symbol') symbol: string) {
    return this.engine.get(`/brvm/reports/symbol/${symbol}`, { timeout: 30_000 });
  }

  @Get('brvm/reports/:slug')
  brvmReportBySlug(@Param('slug') slug: string) {
    return this.engine.get(`/brvm/reports/${slug}`, { timeout: 30_000 });
  }

  // ── Deriv ─────────────────────────────────────────────────────────
  @Get('deriv/health')
  derivHealth() {
    return this.engine.get('/deriv/health', { timeout: 5_000 });
  }

  @Post('deriv/multi-analyze')
  derivMultiAnalyze(@Body() body: any) {
    return this.engine.post('/deriv/multi-analyze', body, { timeout: 30_000 });
  }

  @Post('deriv/scalp')
  derivScalp(@Body() body: any) {
    return this.engine.post('/deriv/scalp', body, { timeout: 30_000 });
  }

  // ── Synthetic ─────────────────────────────────────────────────────
  @Get('synthetic/analyze/:symbol')
  syntheticAnalyze(@Param('symbol') symbol: string) {
    return this.engine.get(`/synthetic/analyze/${symbol}`);
  }

  // ── Risk ──────────────────────────────────────────────────────────
  @Post('risk/calculate')
  riskCalculate(@Body() body: any) {
    return this.engine.post('/risk/calculate', body);
  }

  // ── RAG ───────────────────────────────────────────────────────────
  @Post('rag/query')
  ragQuery(@Body() body: any) {
    return this.engine.post('/rag/query', body, { timeout: 30_000 });
  }

  @Post('rag/documents')
  ragAddDoc(@Body() body: any) {
    return this.engine.post('/rag/documents', body, { timeout: 30_000 });
  }

  @Get('rag/documents')
  ragListDocs(@Query('limit') limit?: number) {
    return this.engine.get('/rag/documents', { params: { limit: limit ?? 100 } });
  }

  // ── Indicators ────────────────────────────────────────────────────
  @Get('indicators/klines')
  indicatorsKlines(
    @Query('symbol') symbol: string,
    @Query('interval') interval: string,
    @Query('limit') limit?: number,
  ) {
    return this.engine.get('/indicators/klines', {
      params: { symbol, interval, limit: limit ?? 300 },
    });
  }

  // ── Observability ─────────────────────────────────────────────────
  @Get('observability/dashboard')
  observabilityDashboard() {
    return this.engine.get('/metrics/dashboard/json', { timeout: 5_000 });
  }

  @Post('observability/metrics/reset')
  observabilityMetricsReset() {
    return this.engine.post('/metrics/reset', {});
  }

  // ── Africa ────────────────────────────────────────────────────────
  @Get('africa/health')
  africaHealth() {
    return this.engine.get('/africa/health', { timeout: 5_000 });
  }

  @Get('africa/quotes')
  africaQuotes() {
    return this.engine.get('/africa/quotes');
  }

  @Get('africa/quotes/all')
  africaQuotesAll() {
    return this.engine.get('/africa/quotes/all');
  }

  @Post('africa/scan')
  africaScan(@Body() body: any) {
    return this.engine.post('/africa/scan', body, { timeout: 30_000 });
  }

  @Get('africa/top-movers')
  africaTopMovers() {
    return this.engine.get('/africa/top-movers');
  }

  @Get('africa/history/:symbol')
  africaHistory(@Param('symbol') symbol: string) {
    return this.engine.get(`/africa/history/${symbol}`);
  }

  // ── Risk tracking ─────────────────────────────────────────────────
  @Post('risk/evaluate')
  riskEvaluate(@Body() body: any) {
    return this.engine.post('/risk/evaluate', body);
  }

  @Post('risk/register-position')
  riskRegisterPosition(@Body() body: any) {
    return this.engine.post('/risk/register-position', body);
  }

  @Post('risk/record-trade')
  riskRecordTrade(@Body() body: any) {
    return this.engine.post('/risk/record-trade', body);
  }

  @Post('risk/record-daily-return')
  riskRecordDailyReturn(@Body() body: any) {
    return this.engine.post('/risk/record-daily-return', body);
  }

  @Post('risk/update-capital')
  riskUpdateCapital(@Body() body: any) {
    return this.engine.post('/risk/update-capital', body);
  }

  @Get('risk/status')
  riskStatus() {
    return this.engine.get('/risk/status');
  }

  // ── ML Regime ─────────────────────────────────────────────────────
  @Post('ml/regime/train')
  mlRegimeTrain(@Body() body: any) {
    return this.engine.post('/ml/regime/train', body, { timeout: 120_000 });
  }

  @Post('ml/regime/auto-train')
  mlRegimeAutoTrain(@Body() body: any) {
    return this.engine.post('/ml/regime/auto-train', body, { timeout: 120_000 });
  }

  @Post('ml/regime/predict')
  mlRegimePredict(@Body() body: any) {
    return this.engine.post('/ml/regime/predict', body, { timeout: 30_000 });
  }

  @Get('ml/regime/status')
  mlRegimeStatus() {
    return this.engine.get('/ml/regime/status');
  }

  // ── News & Social ─────────────────────────────────────────────────
  @Get('news/articles')
  newsArticles() {
    return this.engine.get('/news/articles');
  }

  @Get('news/cache')
  newsCache() {
    return this.engine.get('/news/cache');
  }

  @Get('news/health')
  newsHealth() {
    return this.engine.get('/news/health', { timeout: 5_000 });
  }

  @Post('news/sentiment')
  newsSentiment(@Body() body: any) {
    return this.engine.post('/news/sentiment', body, { timeout: 30_000 });
  }

  @Get('scraper/sources')
  scraperSources() {
    return this.engine.get('/scraper/sources');
  }

  @Get('scraper/cache')
  scraperCache() {
    return this.engine.get('/scraper/cache');
  }

  @Get('scraper/fear-greed')
  scraperFearGreed() {
    return this.engine.get('/scraper/fear-greed');
  }

  @Get('social/x/status')
  socialXStatus() {
    return this.engine.get('/social/x/status', { timeout: 5_000 });
  }

  @Get('social/reddit/sentiment')
  socialRedditSentiment() {
    return this.engine.get('/social/reddit/sentiment');
  }

  @Get('social/youtube/sentiment')
  socialYoutubeSentiment() {
    return this.engine.get('/social/youtube/sentiment');
  }

  @Post('social/sentiment/aggregate')
  socialSentimentAggregate(@Body() body: any) {
    return this.engine.post('/social/sentiment/aggregate', body, { timeout: 30_000 });
  }

  // ── On-chain & DEX ────────────────────────────────────────────────
  @Get('onchain/btc-dominance')
  onchainBtcDominance() {
    return this.engine.get('/onchain/btc-dominance');
  }

  @Get('onchain/context/:symbol')
  onchainContext(@Param('symbol') symbol: string) {
    return this.engine.get(`/onchain/context/${symbol}`);
  }

  @Get('onchain/funding/:symbol')
  onchainFunding(@Param('symbol') symbol: string) {
    return this.engine.get(`/onchain/funding/${symbol}`);
  }

  @Get('onchain/open-interest/:symbol')
  onchainOpenInterest(@Param('symbol') symbol: string) {
    return this.engine.get(`/onchain/open-interest/${symbol}`);
  }

  @Get('onchain/spot-perp-basis/:symbol')
  onchainSpotPerpBasis(@Param('symbol') symbol: string) {
    return this.engine.get(`/onchain/spot-perp-basis/${symbol}`);
  }

  @Get('dex/new-pools')
  dexNewPools() {
    return this.engine.get('/dex/new-pools');
  }

  @Get('dex/new-tokens')
  dexNewTokens() {
    return this.engine.get('/dex/new-tokens');
  }

  @Get('dex/search')
  dexSearch(@Query('q') q: string) {
    return this.engine.get('/dex/search', { params: { q } });
  }

  @Get('dex/trending')
  dexTrending() {
    return this.engine.get('/dex/trending');
  }

  @Get('dex/trending-pools')
  dexTrendingPools() {
    return this.engine.get('/dex/trending-pools');
  }

  @Get('dex/token/:chain/:token_address')
  dexToken(
    @Param('chain') chain: string,
    @Param('token_address') tokenAddress: string,
  ) {
    return this.engine.get(`/dex/token/${chain}/${tokenAddress}`);
  }

  @Get('dex/risk-check/:chain/:token_address')
  dexRiskCheck(
    @Param('chain') chain: string,
    @Param('token_address') tokenAddress: string,
  ) {
    return this.engine.get(`/dex/risk-check/${chain}/${tokenAddress}`);
  }

  // ── Massive ───────────────────────────────────────────────────────
  @Get('massive/ticker/:ticker')
  massiveTicker(@Param('ticker') ticker: string) {
    return this.engine.get(`/massive/ticker/${ticker}`, { timeout: 10_000 });
  }

  @Get('massive/ohlcv/:ticker')
  massiveOhlcv(
    @Param('ticker') ticker: string,
    @Query('from_date') fromDate: string,
    @Query('to_date') toDate: string,
    @Query('multiplier') multiplier = '1',
    @Query('timespan') timespan = 'day',
    @Query('limit') limit = '1000',
  ) {
    return this.engine.get(
      `/massive/ohlcv/${ticker}`,
      {
        params: {
          multiplier,
          timespan,
          from_date: fromDate,
          to_date: toDate,
          limit,
        },
        timeout: 20_000,
      },
    );
  }

  // ── PooCoin ───────────────────────────────────────────────────────
  @Get('poocoin/candles-bsc')
  poocoinCandlesBsc(
    @Query('lpAddress') lpAddress: string,
    @Query('interval') interval = '15m',
    @Query('limit') limit = '100',
    @Query('to') to?: string,
    @Query('baseLp') baseLp?: string,
  ) {
    const params: Record<string, any> = { lpAddress, interval, limit };
    if (to) params.to = to;
    if (baseLp) params.baseLp = baseLp;
    return this.engine.get('/poocoin/candles-bsc', { params, timeout: 20_000 });
  }
}
