import { Module } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { EngineHttpModule } from '../engine/engine-http.module';

@Module({
  imports: [EngineHttpModule],
  controllers: [BacktestController],
  providers: [BacktestService],
  exports: [BacktestService],
})
export class BacktestModule {}
