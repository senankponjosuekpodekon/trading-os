import { Module } from '@nestjs/common';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [PortfoliosController],
  providers: [PortfoliosService],
})
export class PortfoliosModule {}
