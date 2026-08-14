import { Injectable } from '@nestjs/common';
import { EngineHttpService } from '../engine/engine-http.service';

@Injectable()
export class AiService {
  constructor(private engine: EngineHttpService) {}

  async explainSignal(signalData: any): Promise<any> {
    return this.engine.post('/llm/explain', signalData, { timeout: 120_000, maxRetries: 0 });
  }

  async weeklyReport(reportData: any): Promise<any> {
    return this.engine.post('/llm/weekly-report', reportData, { timeout: 120_000, maxRetries: 0 });
  }

  async reviewPosition(positionData: any): Promise<any> {
    return this.engine.post('/llm/review-position', positionData, { timeout: 120_000, maxRetries: 0 });
  }

  async chat(chatData: any): Promise<any> {
    return this.engine.post('/llm/chat', chatData, { timeout: 120_000, maxRetries: 0 });
  }

  async health(): Promise<any> {
    try {
      return await this.engine.get('/llm/health', { timeout: 5_000 });
    } catch {
      return { status: 'degraded', message: 'Engine LLM health check timed out' };
    }
  }

  async getDailyPulse(refresh = false): Promise<any> {
    return this.engine.get('/ai/daily-pulse', {
      params: refresh ? { refresh: 'true' } : undefined,
      timeout: 60_000,
    });
  }

  async trainXgboost(market?: string, timeframe?: string, limit = 2000): Promise<any> {
    return this.engine.post('/ml/train-xgboost', { market, timeframe, limit }, { timeout: 120_000, maxRetries: 0 });
  }

  async xgboostStatus(): Promise<any> {
    return this.engine.get('/ml/xgboost-status', { timeout: 10_000 });
  }

  async xgboostPredict(features: any): Promise<any> {
    return this.engine.post('/ml/xgboost-predict', { features }, { timeout: 30_000 });
  }

  async finbertSentiment(text: string, texts?: string[]): Promise<any> {
    return this.engine.post('/ml/finbert-sentiment', { text, texts }, { timeout: 30_000 });
  }

  async tokenGrade(data: any): Promise<any> {
    return this.engine.post('/ml/token-grade', data, { timeout: 10_000 });
  }

  async youtubeSentiment(category: string, refresh = false): Promise<any> {
    return this.engine.get('/social/youtube/sentiment', {
      params: { category, ...(refresh ? { refresh: 'true' } : {}) },
      timeout: 30_000,
    });
  }

  async redditSentiment(category: string, minScore = 10, refresh = false): Promise<any> {
    return this.engine.get('/social/reddit/sentiment', {
      params: { category, min_score: minScore, ...(refresh ? { refresh: 'true' } : {}) },
      timeout: 30_000,
    });
  }

  async aggregateSocialSentiment(category: string, refresh = false): Promise<any> {
    return this.engine.get('/social/sentiment/aggregate', {
      params: { category, ...(refresh ? { refresh: 'true' } : {}) },
      timeout: 30_000,
    });
  }

  async rebalance(positions: any[], profile: string, totalCapital?: number, portfolioRisk?: any): Promise<any> {
    return this.engine.post('/ml/rebalance', { positions, profile, total_capital: totalCapital, portfolio_risk: portfolioRisk }, { timeout: 15_000 });
  }

  async hiddenGems(minLiquidity = 50_000, minVolume = 100_000, limit = 10, refresh = false): Promise<any> {
    return this.engine.get('/ml/hidden-gems', {
      params: { min_liquidity: minLiquidity, min_volume: minVolume, limit, ...(refresh ? { refresh: 'true' } : {}) },
      timeout: 30_000,
    });
  }

  async aiDefense(data: any): Promise<any> {
    return this.engine.post('/ml/ai-defense', data, { timeout: 10_000 });
  }

  async xSentiment(category: string, symbol?: string, refresh = false): Promise<any> {
    return this.engine.get('/social/x/sentiment', {
      params: { category, ...(symbol ? { symbol } : {}), ...(refresh ? { refresh: 'true' } : {}) },
      timeout: 30_000,
    });
  }

  async xApiStatus(): Promise<any> {
    return this.engine.get('/social/x/status', { timeout: 5_000 });
  }

  async preListingDiscover(minScore = 40, limit = 15, refresh = false): Promise<any> {
    return this.engine.get('/alpha/pre-listing/discover', {
      params: { min_score: minScore, limit, ...(refresh ? { refresh: 'true' } : {}) },
      timeout: 30_000,
    });
  }

  async preListingAnalyze(symbol: string): Promise<any> {
    return this.engine.get(`/alpha/pre-listing/analyze/${symbol}`, { timeout: 15_000 });
  }

  async preListingSignals(symbol: string, chain = 'ethereum', refresh = false): Promise<any> {
    return this.engine.get(`/onchain/pre-listing/signals/${symbol}`, {
      params: { chain, ...(refresh ? { refresh: 'true' } : {}) },
      timeout: 15_000,
    });
  }

  async scientificReport(data: any): Promise<any> {
    return this.engine.post('/backtest/scientific-report', data, { timeout: 30_000 });
  }

  async monteCarlo(data: any): Promise<any> {
    return this.engine.post('/backtest/monte-carlo', data, { timeout: 30_000 });
  }

  async walkForward(data: any): Promise<any> {
    return this.engine.post('/backtest/walk-forward', data, { timeout: 15_000 });
  }

  async overfittingCheck(inSample: any, outSample: any): Promise<any> {
    return this.engine.post('/backtest/overfitting-check', { in_sample: inSample, out_sample: outSample }, { timeout: 10_000 });
  }

  async shadowPredict(features: any): Promise<any> {
    return this.engine.post('/ml/predict-shadow', { features }, { timeout: 10_000 });
  }

  async shadowStats(): Promise<any> {
    return this.engine.get('/ml/shadow-stats', { timeout: 5_000 });
  }

  async shadowReset(): Promise<any> {
    return this.engine.post('/ml/shadow-reset', {}, { timeout: 5_000 });
  }

  // ── Phase D: Market Memory + Feedback Loop + Multi-Agent ──

  async memoryStore(data: any): Promise<any> {
    return this.engine.post('/memory/store', data, { timeout: 5_000 });
  }

  async memoryResolve(data: any): Promise<any> {
    return this.engine.post('/memory/resolve', data, { timeout: 5_000 });
  }

  async memoryRecall(data: any): Promise<any> {
    return this.engine.post('/memory/recall', data, { timeout: 5_000 });
  }

  async memoryStats(data: any): Promise<any> {
    return this.engine.post('/memory/stats', data, { timeout: 5_000 });
  }

  async memorySummary(): Promise<any> {
    return this.engine.get('/memory/summary', { timeout: 5_000 });
  }

  async memoryInitDb(): Promise<any> {
    return this.engine.post('/memory/init-db', {}, { timeout: 10_000 });
  }

  async feedbackRegister(data: any): Promise<any> {
    return this.engine.post('/feedback/register', data, { timeout: 5_000 });
  }

  async feedbackTick(livePrices: any): Promise<any> {
    return this.engine.post('/feedback/tick', { live_prices: livePrices }, { timeout: 10_000 });
  }

  async feedbackStats(): Promise<any> {
    return this.engine.get('/feedback/stats', { timeout: 5_000 });
  }

  async agentsAnalyze(data: any): Promise<any> {
    return this.engine.post('/agents/analyze', data, { timeout: 15_000 });
  }

  async agentsStatus(): Promise<any> {
    return this.engine.get('/agents/status', { timeout: 5_000 });
  }

  async agentsPerformance(data: any): Promise<any> {
    return this.engine.post('/agents/performance', data, { timeout: 5_000 });
  }
}
