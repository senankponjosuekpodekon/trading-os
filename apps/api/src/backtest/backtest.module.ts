import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { BacktestProcessor } from './backtest.processor';
import { EngineHttpModule } from '../engine/engine-http.module';

@Module({
  imports: [
    EngineHttpModule,
    BullModule.registerQueue({ name: 'backtest' }),
  ],
  controllers: [BacktestController],
  providers: [BacktestService, BacktestProcessor],
  exports: [BacktestService],
})
export class BacktestModule {}
