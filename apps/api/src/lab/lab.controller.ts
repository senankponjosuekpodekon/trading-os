import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LabService, RunLabBacktestDto } from './lab.service';
import { CreateLabSessionDto } from './dto/create-lab-session.dto';
import { ProfileSuitabilityDto } from './dto/profile-suitability.dto';

class CompareSessionsDto {
  ids!: string[];
}

@Controller('lab')
@UseGuards(JwtAuthGuard)
export class LabController {
  constructor(private labService: LabService) {}

  @Post('sessions')
  create(
    @Request() req: any,
    @Body() dto: CreateLabSessionDto,
  ) {
    return this.labService.createSession(req.user.id, dto);
  }

  @Get('sessions')
  findAll(
    @Request() req: any,
    @Query('status') status?: string,
  ) {
    return this.labService.findByUser(req.user.id, status);
  }

  @Get('sessions/:id')
  findOne(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.labService.findOne(req.user.id, id);
  }

  @Post('sessions/:id/backtest')
  runBacktest(
    @Request() req: any,
    @Param('id') id: string,
    @Body() runDto: RunLabBacktestDto,
  ) {
    return this.labService.runBacktest(req.user.id, id, runDto);
  }

  @Post('sessions/:id/evaluate')
  evaluate(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.labService.evaluate(req.user.id, id);
  }

  @Get('sessions/:id/report')
  report(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.labService.generateReport(req.user.id, id);
  }

  @Get('sessions/:id/walk-forward')
  walkForward(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.labService.walkForwardAnalysis(req.user.id, id);
  }

  @Post('sessions/:id/suitability')
  suitability(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ProfileSuitabilityDto,
  ) {
    return this.labService.findOne(req.user.id, id).then(session =>
      this.labService.profileSuitability(session.backtestMetrics as any, dto),
    );
  }

  @Post('sessions/:id/promote')
  promote(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.labService.promoteToProduction(req.user.id, id);
  }

  @Post('sessions/:id/archive')
  archive(
    @Request() req: any,
    @Param('id') id: string,
  ) {
    return this.labService.updateSession(req.user.id, id, { status: 'ARCHIVED' });
  }

  @Post('sessions/:id')
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateLabSessionDto>,
  ) {
    return this.labService.updateSession(req.user.id, id, dto);
  }

  @Get('templates')
  templates() {
    return this.labService.getStrategyTemplates();
  }

  @Post('compare')
  compare(
    @Request() req: any,
    @Body() dto: CompareSessionsDto,
  ) {
    return this.labService.compareSessions(req.user.id, dto.ids);
  }
}
