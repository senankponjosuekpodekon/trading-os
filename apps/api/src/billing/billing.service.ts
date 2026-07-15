import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {}

  async listPlans() {
    return this.prisma.plan.findMany({ where: { isActive: true } });
  }

  async findPlan(code: string) {
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    if (!plan) throw new NotFoundException(`Plan ${code} not found`);
    return plan;
  }

  async createPlan(dto: CreatePlanDto) {
    return this.prisma.plan.create({
      data: {
        name: dto.name,
        code: dto.code,
        price: dto.price,
        interval: dto.interval,
        maxStrategies: dto.maxStrategies ?? null,
        maxSignals: dto.maxSignals ?? null,
        maxPortfolios: dto.maxPortfolios ?? null,
        features: dto.features ?? [],
        isActive: dto.isActive ?? true,
      },
    });
  }

  async subscribe(userId: string, planCode: string, trialDays = 14) {
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new NotFoundException(`Plan ${planCode} not found`);

    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + trialDays);

    await this.prisma.subscription.updateMany({
      where: { userId, status: { in: ['ACTIVE', 'TRIAL'] } },
      data: { status: 'CANCELLED' },
    });

    return this.prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: 'TRIAL',
        currentPeriodStart: now,
        currentPeriodEnd: end,
      },
      include: { plan: true },
    });
  }

  async getActiveSubscription(userId: string) {
    return this.prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'TRIAL'] } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
  }

  async cancel(userId: string) {
    const active = await this.getActiveSubscription(userId);
    if (!active) throw new BadRequestException('No active subscription');
    return this.prisma.subscription.update({
      where: { id: active.id },
      data: { status: 'CANCELLED' },
    });
  }
}
