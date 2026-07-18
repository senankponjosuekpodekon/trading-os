import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

/**
 * Sprint 8 — Enforcement des quotas du plan de souscription.
 * Sans souscription active ou sans limite définie sur le plan, aucune restriction n'est appliquée.
 */
@Injectable()
export class QuotaService {
  private startOfUtcDay(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  private async getPlanLimits(userId: string) {
    const sub = await this.billing.getActiveSubscription(userId);
    return sub?.plan ?? null;
  }

  async assertCanCreatePortfolio(userId: string): Promise<void> {
    const plan = await this.getPlanLimits(userId);
    if (!plan || plan.maxPortfolios == null) return;
    const count = await this.prisma.portfolio.count({ where: { userId } });
    if (count >= plan.maxPortfolios) {
      throw new ForbiddenException(
        `Quota atteint : votre plan ${plan.name} autorise ${plan.maxPortfolios} portfolio(s)`,
      );
    }
  }

  async assertCanEnableStrategy(userId: string): Promise<void> {
    const plan = await this.getPlanLimits(userId);
    if (!plan || plan.maxStrategies == null) return;
    const count = await this.prisma.userStrategy.count({ where: { userId, isEnabled: true } });
    if (count >= plan.maxStrategies) {
      throw new ForbiddenException(
        `Quota atteint : votre plan ${plan.name} autorise ${plan.maxStrategies} stratégie(s) active(s)`,
      );
    }
  }

  private async getSignalUsage(userId: string) {
    const today = this.startOfUtcDay();
    const usage = await this.prisma.signalDailyUsage.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    return usage?.signalsUsed ?? 0;
  }

  async incrementSignalUsage(userId: string, delta: number) {
    if (delta <= 0) return;
    const today = this.startOfUtcDay();
    await this.prisma.signalDailyUsage.upsert({
      where: { userId_date: { userId, date: today } },
      update: { signalsUsed: { increment: delta } },
      create: { userId, date: today, signalsUsed: delta },
    });
  }

  async getSignalAllowance(userId: string) {
    const plan = await this.getPlanLimits(userId);
    if (!plan || plan.maxSignals == null) {
      return { limit: null, used: 0 };
    }
    const used = await this.getSignalUsage(userId);
    return { limit: plan.maxSignals, used };
  }

  async assertSignalQuota(userId: string) {
    const allowance = await this.getSignalAllowance(userId);
    if (allowance.limit !== null && allowance.used >= allowance.limit) {
      throw new ForbiddenException('Quota signal quotidien atteint. Passez à un plan supérieur pour recevoir plus d’alertes.');
    }
    return allowance;
  }

  async getUsage(userId: string) {
    const plan = await this.getPlanLimits(userId);
    const [portfolios, strategies, signalAllowance] = await Promise.all([
      this.prisma.portfolio.count({ where: { userId } }),
      this.prisma.userStrategy.count({ where: { userId, isEnabled: true } }),
      this.getSignalAllowance(userId),
    ]);
    return {
      plan: plan ? { name: plan.name, code: plan.code } : null,
      portfolios: { used: portfolios, limit: plan?.maxPortfolios ?? null },
      strategies: { used: strategies, limit: plan?.maxStrategies ?? null },
      signals: { used: signalAllowance.used, limit: signalAllowance.limit },
    };
  }
}
