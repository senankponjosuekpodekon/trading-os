import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BacktestService } from './backtest.service';
import { RunBacktestDto } from './dto/run-backtest.dto';

@Controller('backtest')
@UseGuards(JwtAuthGuard)
export class BacktestController {
  constructor(private backtestService: BacktestService) {}

  @Post('run')
  run(
    @Request() req: any,
    @Body() dto: RunBacktestDto,
  ) {
    return this.backtestService.run(req.user.id, dto);
  }

  @Post('multi')
  runMulti(
    @Request() req: any,
    @Body() dtos: RunBacktestDto[],
  ) {
    return this.backtestService.runMulti(req.user.id, dtos);
  }

  @Post('advanced-metrics')
  advancedMetrics(
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.backtestService.advancedMetrics(body);
  }

  @Post('pattern-stats')
  patternStats(
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.backtestService.patternStats(body);
  }
}
