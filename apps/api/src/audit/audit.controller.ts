import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('all')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
  ) {
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 50;
    return this.auditService.findAll({
      page: Number.isNaN(pageNum) || pageNum < 1 ? 1 : pageNum,
      limit: Number.isNaN(limitNum) || limitNum < 1 ? 50 : Math.min(limitNum, 200),
      userId: userId || undefined,
      action: action || undefined,
    });
  }
}
