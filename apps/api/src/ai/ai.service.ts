import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiService {
  private readonly engineUrl: string;

  constructor(
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async explainSignal(signalData: any): Promise<any> {
    const { data } = await firstValueFrom(
      this.http.post(`${this.engineUrl}/llm/explain`, signalData),
    );
    return data;
  }

  async weeklyReport(reportData: any): Promise<any> {
    const { data } = await firstValueFrom(
      this.http.post(`${this.engineUrl}/llm/weekly-report`, reportData),
    );
    return data;
  }

  async health(): Promise<any> {
    const { data } = await firstValueFrom(
      this.http.get(`${this.engineUrl}/llm/health`),
    );
    return data;
  }
}
