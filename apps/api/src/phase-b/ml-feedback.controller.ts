import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MlFeedbackService, FeedbackStats, RecalculateAllResult, FeedbackSummary } from './ml-feedback.service';
import { CreateSignalFeedbackDto } from './dto/signal-feedback.dto';

@Controller('phase-b/ml-feedback')
@UseGuards(JwtAuthGuard)
export class MlFeedbackController {
  constructor(private readonly mlFeedbackService: MlFeedbackService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateSignalFeedbackDto) {
    return this.mlFeedbackService.create(req.user.id, dto);
  }

  @Get('signal/:signalId')
  findBySignal(@Param('signalId') signalId: string) {
    return this.mlFeedbackService.findBySignal(signalId);
  }

  @Get('signal/:signalId/stats')
  async stats(@Param('signalId') signalId: string): Promise<FeedbackStats> {
    return this.mlFeedbackService.computeSignalStats(signalId);
  }

  @Post('signal/:signalId/recalculate')
  async recalculate(@Param('signalId') signalId: string): Promise<FeedbackStats> {
    return this.mlFeedbackService.updateSignalQuality(signalId);
  }

  @Get('leaderboard')
  leaderboard() {
    return this.mlFeedbackService.getLeaderboard();
  }

  @Post('recalculate-all')
  async recalculateAll(): Promise<RecalculateAllResult> {
    return this.mlFeedbackService.recalculateAll();
  }

  @Get('summary')
  async summary(): Promise<FeedbackSummary> {
    return this.mlFeedbackService.getSummary();
  }
}
