import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistDto } from './dto/waitlist.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('waitlist')
export class WaitlistController {
  constructor(private waitlist: WaitlistService) {}

  // Public — accessible même en maintenance (allowlist du MaintenanceGuard)
  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async create(@Body() dto: CreateWaitlistDto) {
    await this.waitlist.create(dto);
    return { ok: true };
  }
}

@Controller('admin/waitlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminWaitlistController {
  constructor(private waitlist: WaitlistService) {}

  @Get()
  findAll() {
    return this.waitlist.findAll();
  }

  @Post('notify')
  notifyAll() {
    return this.waitlist.notifyAll();
  }
}
