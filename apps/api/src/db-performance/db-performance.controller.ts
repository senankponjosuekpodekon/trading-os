import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DbPerformanceService } from './db-performance.service';

@Controller('admin/db-performance')
@UseGuards(JwtAuthGuard)
export class DbPerformanceController {
  constructor(private service: DbPerformanceService) {}

  @Get()
  analyze(): ReturnType<DbPerformanceService['analyze']> {
    return this.service.analyze();
  }
}
