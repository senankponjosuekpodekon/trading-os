import { Controller, Get, Query, Param } from '@nestjs/common';
import { MarketDataService } from './market-data.service';

@Controller('market-data')
export class MarketDataController {
  constructor(private readonly marketDataService: MarketDataService) {}

  @Get('fear-greed')
  async fearGreed(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 1;
    return this.marketDataService.getFearGreed(Number.isNaN(n) || n < 1 ? 1 : n);
  }

  @Get('funding-rates')
  async fundingRates() {
    return this.marketDataService.getFundingRates();
  }

  @Get('economic-calendar')
  async economicCalendar() {
    return this.marketDataService.getEconomicCalendar();
  }

  @Get('on-chain/btc')
  async onChainBtc() {
    return this.marketDataService.getOnChainBtc();
  }

  @Get('on-chain/eth')
  async onChainEth() {
    return this.marketDataService.getOnChainEth();
  }

  @Get('basis')
  async basis() {
    return this.marketDataService.getSpotPerpBasis();
  }

  @Get('cot/:asset')
  async cot(@Param('asset') asset: string) {
    return this.marketDataService.getCot(asset);
  }
}
