import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PositionsService } from './positions.service';
import { CreatePositionDto } from './dto/create-position.dto';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(private positionsService: PositionsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreatePositionDto) {
    return this.positionsService.create(req.user.id, dto);
  }

  @Post('from-signal/:signalId')
  openFromSignal(@Request() req: any, @Param('signalId') signalId: string) {
    return this.positionsService.openFromSignal(req.user.id, signalId);
  }

  @Get()
  findByPortfolio(@Request() req: any, @Query('portfolioId') portfolioId: string) {
    return this.positionsService.findByPortfolio(req.user.id, portfolioId);
  }

  @Get('live')
  getLive(@Request() req: any, @Query('portfolioId') portfolioId?: string) {
    return this.positionsService.getLivePositions(req.user.id, portfolioId);
  }

  @Get('summary')
  getSummary(@Request() req: any, @Query('portfolioId') portfolioId?: string) {
    return this.positionsService.getSummary(req.user.id, portfolioId);
  }

  @Patch(':id/close')
  close(
    @Request() req: any,
    @Param('id') id: string,
    @Body('exitPrice') exitPrice: number,
  ) {
    return this.positionsService.close(req.user.id, id, exitPrice);
  }
}
