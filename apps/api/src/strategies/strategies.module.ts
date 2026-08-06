import { Module } from '@nestjs/common';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { BillingModule } from '../billing/billing.module';
import { EngineHttpModule } from '../engine/engine-http.module';

@Module({
  imports: [BillingModule, EngineHttpModule],
  controllers: [StrategiesController],
  providers: [StrategiesService],
  exports: [StrategiesService],
})
export class StrategiesModule {}
