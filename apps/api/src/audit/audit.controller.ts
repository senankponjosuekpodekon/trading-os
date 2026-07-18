import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  findByUser(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 50;
    return this.auditService.findByUser(req.user.id, {
      page: Number.isNaN(pageNum) || pageNum < 1 ? 1 : pageNum,
      limit: Number.isNaN(limitNum) || limitNum < 1 ? 50 : limitNum,
    });
  }
}
