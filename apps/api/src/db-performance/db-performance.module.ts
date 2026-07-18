import { Module } from '@nestjs/common';
import { DbPerformanceController } from './db-performance.controller';
import { DbPerformanceService } from './db-performance.service';

@Module({
  controllers: [DbPerformanceController],
  providers: [DbPerformanceService],
})
export class DbPerformanceModule {}
