import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BacktestService } from './backtest.service';
import { RunBacktestDto } from './dto/run-backtest.dto';

@Controller('backtest')
@UseGuards(JwtAuthGuard)
export class BacktestController {
  constructor(
    private backtestService: BacktestService,
    @InjectQueue('backtest') private backtestQueue: Queue,
  ) {}

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

  @Post('run-async')
  async runAsync(
    @Request() req: any,
    @Body() dto: RunBacktestDto,
  ) {
    const job = await this.backtestQueue.add('run', {
      userId: req.user.id,
      dto,
    });
    return { jobId: job.id };
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await this.backtestQueue.getJob(id);
    if (!job) {
      return { status: 'not_found' };
    }
    const state = await job.getState();
    return {
      jobId: id,
      state,
      progress: job.progress,
      result: job.returnvalue,
      failedReason: job.failedReason,
    };
  }
}
