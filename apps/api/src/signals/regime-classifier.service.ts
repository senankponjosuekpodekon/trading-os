import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class RegimeClassifierService {
  private readonly logger = new Logger(RegimeClassifierService.name);
  private readonly engineUrl: string;

  constructor(private http: HttpService, config: ConfigService) {
    this.engineUrl = config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async train(prices: number[]) {
    return this.post('/ml/regime/train', { prices });
  }

  async predict(prices: number[]) {
    return this.post('/ml/regime/predict', { prices });
  }

  async status() {
    return this.get('/ml/regime/status');
  }

  private async post(path: string, body: any) {
    try {
      const res = await firstValueFrom(this.http.post(`${this.engineUrl}${path}`, body));
      return res.data;
    } catch (error) {
      this.logger.error('RegimeClassifier POST failed', { path, error: (error as any)?.message ?? error });
      throw error;
    }
  }

  private async get(path: string) {
    try {
      const res = await firstValueFrom(this.http.get(`${this.engineUrl}${path}`));
      return res.data;
    } catch (error) {
      this.logger.error('RegimeClassifier GET failed', { path, error: (error as any)?.message ?? error });
      throw error;
    }
  }
}
