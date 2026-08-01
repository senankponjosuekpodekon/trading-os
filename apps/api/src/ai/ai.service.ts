import { Injectable } from '@nestjs/common';
import { EngineHttpService } from '../engine/engine-http.service';

@Injectable()
export class AiService {
  constructor(private engine: EngineHttpService) {}

  async explainSignal(signalData: any): Promise<any> {
    return this.engine.post('/llm/explain', signalData, { timeout: 30_000 });
  }

  async weeklyReport(reportData: any): Promise<any> {
    return this.engine.post('/llm/weekly-report', reportData, { timeout: 30_000 });
  }

  async reviewPosition(positionData: any): Promise<any> {
    return this.engine.post('/llm/review-position', positionData, { timeout: 30_000 });
  }

  async chat(chatData: any): Promise<any> {
    return this.engine.post('/llm/chat', chatData, { timeout: 30_000 });
  }

  async health(): Promise<any> {
    return this.engine.get('/llm/health', { timeout: 5_000 });
  }
}
