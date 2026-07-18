import { Module } from '@nestjs/common';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [StrategiesController],
  providers: [StrategiesService],
  exports: [StrategiesService],
})
export class StrategiesModule {}
