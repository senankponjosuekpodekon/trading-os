import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { QuotaService } from './quota.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, QuotaService],
  exports: [BillingService, QuotaService],
})
export class BillingModule {}
