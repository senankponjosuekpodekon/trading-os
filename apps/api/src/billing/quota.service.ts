import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

/**
 * Sprint 8 — Enforcement des quotas du plan de souscription.
 * Sans souscription active, un free tier par défaut est appliqué.
 */

// Free tier defaults for users without an active subscription (#34 fix)
const FREE_TIER_LIMITS = {
  maxPortfolios: 1,
  maxStrategies: 1,
  maxSignals: 5,
};

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
    if (sub?.plan) return sub.plan;
    // #34 fix: return free tier limits instead of null (fail-open was a security hole)
    return {
      name: 'Free',
      code: 'FREE',
      maxPortfolios: FREE_TIER_LIMITS.maxPortfolios,
      maxStrategies: FREE_TIER_LIMITS.maxStrategies,
      maxSignals: FREE_TIER_LIMITS.maxSignals,
    } as any;
  }

  async assertCanCreatePortfolio(userId: string): Promise<void> {
    const plan = await this.getPlanLimits(userId);
    if (plan.maxPortfolios == null) return;
    const count = await this.prisma.portfolio.count({ where: { userId } });
    if (count >= plan.maxPortfolios) {
      throw new ForbiddenException(
        `Quota atteint : votre plan ${plan.name} autorise ${plan.maxPortfolios} portfolio(s)`,
      );
    }
  }

  async assertCanEnableStrategy(userId: string): Promise<void> {
    const plan = await this.getPlanLimits(userId);
    if (plan.maxStrategies == null) return;
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

  /**
   * #33 fix: Atomic check-and-increment to prevent TOCTOU race condition.
   * Uses a conditional UPDATE ... WHERE signals_used < limit RETURNING ...
   * If no row is returned, the quota was exceeded.
   */
  async incrementSignalUsage(userId: string, delta: number) {
    if (delta <= 0) return;
    const plan = await this.getPlanLimits(userId);
    if (plan.maxSignals == null) return;

    const today = this.startOfUtcDay();
    const limit = plan.maxSignals;

    // Try atomic conditional increment
    const updated = await this.prisma.signalDailyUsage.updateMany({
      where: {
        userId,
        date: today,
        signalsUsed: { lt: limit },
      },
      data: { signalsUsed: { increment: delta } },
    });

    if (updated.count > 0) return; // Successfully incremented atomically

    // No row matched — either row doesn't exist yet, or quota exceeded
    const existing = await this.prisma.signalDailyUsage.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (existing) {
      // Row exists but signalsUsed >= limit → quota exceeded
      throw new ForbiddenException("Quota signal quotidien atteint. Passez à un plan supérieur pour recevoir plus d'alertes.");
    }

    // Row doesn't exist — create it with delta (only if delta <= limit)
    if (delta > limit) {
      throw new ForbiddenException("Quota signal quotidien atteint. Passez à un plan supérieur pour recevoir plus d'alertes.");
    }
    try {
      await this.prisma.signalDailyUsage.create({
        data: { userId, date: today, signalsUsed: delta },
      });
    } catch {
      // Race: another request created the row between our check and create
      // Re-check and increment atomically
      const retry = await this.prisma.signalDailyUsage.updateMany({
        where: { userId, date: today, signalsUsed: { lt: limit } },
        data: { signalsUsed: { increment: delta } },
      });
      if (retry.count === 0) {
        throw new ForbiddenException("Quota signal quotidien atteint. Passez à un plan supérieur pour recevoir plus d'alertes.");
      }
    }
  }

  async getSignalAllowance(userId: string) {
    const plan = await this.getPlanLimits(userId);
    if (plan.maxSignals == null) {
      return { limit: null, used: 0 };
    }
    const used = await this.getSignalUsage(userId);
    return { limit: plan.maxSignals, used };
  }

  async assertSignalQuota(userId: string) {
    const allowance = await this.getSignalAllowance(userId);
    if (allowance.limit !== null && allowance.used >= allowance.limit) {
      throw new ForbiddenException("Quota signal quotidien atteint. Passez à un plan supérieur pour recevoir plus d'alertes.");
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
