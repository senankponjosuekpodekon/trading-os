import { Module } from '@nestjs/common';
import { PricesProxyService } from './prices-proxy.service';

@Module({
  providers: [PricesProxyService],
  exports: [PricesProxyService],
})
export class PricesProxyModule {}
