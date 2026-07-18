import { Controller, Get, Post, Body, UseGuards, Request, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { BillingService } from './billing.service';
import { QuotaService } from './quota.service';
import { CreatePlanDto } from './dto/create-plan.dto';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(
    private billingService: BillingService,
    private quotaService: QuotaService,
  ) {}

  @Get('plans')
  listPlans() {
    return this.billingService.listPlans();
  }

  @Get('subscription')
  getSubscription(@Request() req: any) {
    return this.billingService.getActiveSubscription(req.user.id);
  }

  @Get('usage')
  getUsage(@Request() req: any) {
    return this.quotaService.getUsage(req.user.id);
  }

  @Post('subscribe/:code')
  subscribe(
    @Request() req: any,
    @Param('code') code: string,
  ) {
    return this.billingService.subscribe(req.user.id, code);
  }

  @Post('cancel')
  cancel(@Request() req: any) {
    return this.billingService.cancel(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.billingService.createPlan(dto);
  }
}
