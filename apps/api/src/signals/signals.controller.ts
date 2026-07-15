import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('signals')
@UseGuards(JwtAuthGuard)
export class SignalsController {
  constructor(
    private signalsService: SignalsService,
    private outcomeService: SignalOutcomeService,
  ) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('profile') profile?: string,
  ) {
    return this.signalsService.findAll({
      page:    page   ? Math.max(1, parseInt(page, 10))   : 1,
      limit:   limit  ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
      sort:    sort   || 'createdAt:desc',
      profile: profile,
    });
  }

  @Post('scan')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  triggerScan(@Body() body: { symbols: string[]; timeframe?: string }) {
    return this.signalsService.triggerScan(body.symbols, body.timeframe ?? '1h');
  }

  @Get('stats')
  getStats(@Query('market') market?: string) {
    return this.outcomeService.getStats(market);
  }
}
