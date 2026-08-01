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
}
