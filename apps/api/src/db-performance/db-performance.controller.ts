import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { DbPerformanceService } from './db-performance.service';

@Controller('admin/db-performance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DbPerformanceController {
  constructor(private service: DbPerformanceService) {}

  @Get()
  analyze(): ReturnType<DbPerformanceService['analyze']> {
    return this.service.analyze();
  }
}
