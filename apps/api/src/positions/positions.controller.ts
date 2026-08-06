import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PositionsService } from './positions.service';
import { CrossPositionRiskService } from './cross-position-risk.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdateTrailingStopDto } from './dto/update-trailing-stop.dto';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(
    private positionsService: PositionsService,
    private crossRisk: CrossPositionRiskService,
  ) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreatePositionDto) {
    return this.positionsService.create(req.user.id, dto);
  }

  @Post('from-signal/:signalId')
  openFromSignal(
    @Request() req: any,
    @Param('signalId') signalId: string,
    @Query('type') type?: 'PAPER' | 'LIVE',
  ) {
    return this.positionsService.openFromSignal(req.user.id, signalId, type || 'PAPER');
  }

  @Get()
  findByPortfolio(
    @Request() req: any,
    @Query('portfolioId') portfolioId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('status') status?: string,
  ) {
    return this.positionsService.findByPortfolio(req.user.id, portfolioId, {
      page:   page   ? Math.max(1, parseInt(page, 10))   : 1,
      limit:  limit  ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20,
      sort:   sort   || 'openedAt:desc',
      status,
    });
  }

  @Get('live')
  getLive(@Request() req: any, @Query('portfolioId') portfolioId?: string) {
    return this.positionsService.getLivePositions(req.user.id, portfolioId);
  }

  @Get('summary')
  getSummary(@Request() req: any, @Query('portfolioId') portfolioId?: string) {
    return this.positionsService.getSummary(req.user.id, portfolioId);
  }

  @Get('correlation-report')
  getCorrelationReport(@Request() req: any, @Query('portfolioId') portfolioId: string) {
    return this.crossRisk.getCorrelationReport(portfolioId);
  }

  @Patch(':id/close')
  close(
    @Request() req: any,
    @Param('id') id: string,
    @Body('exitPrice') exitPrice: number,
  ) {
    return this.positionsService.close(req.user.id, id, exitPrice);
  }

  @Post(':id/trailing-stop')
  updateTrailingStop(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTrailingStopDto,
  ) {
    return this.positionsService.setTrailingStop(req.user.id, id, dto);
  }

  @Post(':id/continuation-advice')
  continuationAdvice(
    @Request() req: any,
    @Param('id') id: string,
    @Body('currentPrice') currentPrice?: number,
  ) {
    return this.positionsService.continuationAdvice(req.user.id, id, currentPrice);
  }

  @Post(':id/pyramid')
  pyramid(@Request() req: any, @Param('id') id: string) {
    return this.positionsService.pyramid(req.user.id, id);
  }
}
