import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
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

  @Get(':id/export')
  async exportHtml(@Param('id') id: string, @Res() res: Response) {
    const report = await this.reports.getReport(id);
    if (!report) {
      res.status(404).send('Report not found');
      return;
    }
    const html = this.reports.generateReportHtml(report);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${new Date(report.date).toISOString().slice(0, 10)}.html"`);
    res.send(html);
  }

  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  generate() {
    return this.reports.generateDailyReport();
  }
}
