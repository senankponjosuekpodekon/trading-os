import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('signals')
@UseGuards(JwtAuthGuard)
export class SignalsController {
  constructor(private signalsService: SignalsService) {}

  @Get()
  findAll(@Query('limit') limit?: string) {
    return this.signalsService.findAll(limit ? parseInt(limit) : 50);
  }

  @Post('scan')
  triggerScan(@Body() body: { symbols: string[]; timeframe?: string }) {
    return this.signalsService.triggerScan(body.symbols, body.timeframe ?? '1h');
  }
}
