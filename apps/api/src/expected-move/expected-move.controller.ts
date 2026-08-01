import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ExpectedMoveService } from './expected-move.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const DEFAULT_HORIZONS = [5, 10, 20];

@Controller('expected-move')
@UseGuards(JwtAuthGuard)
export class ExpectedMoveController {
  constructor(private readonly expectedMoveService: ExpectedMoveService) {}

  @Get()
  async getExpectedMove(
    @Query('symbol') symbol?: string,
    @Query('timeframe') timeframe = '1h',
    @Query('horizons') horizons?: string,
    @Query('limit') limit?: string,
  ) {
    if (!symbol) {
      throw new BadRequestException('symbol is required');
    }

    let limitValue = limit ? Number(limit) : 400;
    if (Number.isNaN(limitValue) || limitValue < 150 || limitValue > 600) {
      limitValue = 400;
    }

    let horizonList = DEFAULT_HORIZONS;
    if (horizons) {
      const parsed = horizons
        .split(',')
        .map(h => parseInt(h.trim(), 10))
        .filter(h => Number.isFinite(h) && h > 0);
      if (parsed.length) {
        horizonList = [...new Set(parsed)].sort((a, b) => a - b);
      }
    }

    return this.expectedMoveService.getExpectedMove(symbol, timeframe, horizonList, limitValue);
  }
}
