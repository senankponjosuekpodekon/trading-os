import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SystemHealthService } from './system-health.service';

@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  @Roles(UserRole.SUPER_ADMIN)
  @Get('health')
  async getHealth() {
    return this.health.getHealthSummary();
  }
}
