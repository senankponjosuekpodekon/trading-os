import { Processor, Process } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BacktestService } from './backtest.service';

@Processor('backtest')
export class BacktestProcessor {
  constructor(private readonly backtestService: BacktestService) {}

  @Process('run')
  async processRun(job: Job<{ userId: string; dto: any }>) {
    const { userId, dto } = job.data;
    return this.backtestService.run(userId, dto);
  }
}
