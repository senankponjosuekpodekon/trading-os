import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';

@Module({
  imports: [HttpModule],
  controllers: [BacktestController],
  providers: [BacktestService],
  exports: [BacktestService],
})
export class BacktestModule {}
