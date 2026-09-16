import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BacktestService } from './backtest.service';

@Processor('backtest')
export class BacktestProcessor extends WorkerHost {
  constructor(private readonly backtestService: BacktestService) {
    super();
  }

  async process(job: Job<{ userId: string; dto: any }>) {
    const { userId, dto } = job.data;
    return this.backtestService.run(userId, dto);
  }
}
