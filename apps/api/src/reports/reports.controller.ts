import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    const lim = limit ? Math.min(90, Math.max(1, parseInt(limit, 10))) : 30;
    return this.reports.listReports(lim);
  }

  @Get('latest')
  latest() {
    return this.reports.getLatestReport();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.reports.getReport(id);
  }

  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  generate() {
    return this.reports.generateDailyReport();
  }
}
