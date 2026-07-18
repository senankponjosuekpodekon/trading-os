import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface SignalFeatures {
  confidence: number;
  scoreTotal?: number;
  scoreTrend?: number;
  scorePA?: number;
  scoreSR?: number;
  scorePatterns?: number;
  scoreRegime?: number;
  scoreSMC?: number;
  scoreMTF?: number;
  scoreSentiment?: number;
  adx?: number;
  riskReward?: number;
  patternConfluenceScore?: number;
}

@Injectable()
export class SignalPredictorService {
  private readonly logger = new Logger(SignalPredictorService.name);
  private readonly engineUrl: string;

  constructor(private http: HttpService, private config: ConfigService) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async train(market?: string, timeframe?: string, limit = 2000) {
    return this.post('/ml/train', { market, timeframe, limit });
  }

  async predict(features: SignalFeatures) {
    return this.post('/ml/predict', { features });
  }

  async getFeatureWeights() {
    return this.status();
  }

  async getStatus() {
    return this.status();
  }

  private async status() {
    return this.get('/ml/status');
  }

  private async post(path: string, body: any) {
    try {
      const res = await firstValueFrom(this.http.post(`${this.engineUrl}${path}`, body));
      return res.data;
    } catch (error) {
      this.logger.error('SignalPredictor POST failed', { path, error: error?.message ?? error });
      throw error;
    }
  }

  private async get(path: string) {
    try {
      const res = await firstValueFrom(this.http.get(`${this.engineUrl}${path}`));
      return res.data;
    } catch (error) {
      this.logger.error('SignalPredictor GET failed', { path, error: error?.message ?? error });
      throw error;
    }
  }
}
