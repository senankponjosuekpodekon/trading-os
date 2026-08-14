import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../billing/quota.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { CreateStrategyDto, UpdateStrategyDto, ToggleUserStrategyDto } from './dto/create-strategy.dto';
import { validateStrategyRules } from './rules-validator';

@Injectable()
export class StrategiesService {
  constructor(
    private prisma: PrismaService,
    private quota: QuotaService,
    private engine: EngineHttpService,
  ) {}

  async findAll() {
    return this.prisma.strategy.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllWithUserStatus(userId: string) {
    const strategies = await this.prisma.strategy.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const userStrategies = await this.prisma.userStrategy.findMany({
      where: { userId },
    });
    const map = new Map(userStrategies.map(us => [us.strategyId, us]));
    return strategies.map(s => ({
      ...s,
      userStrategy: map.get(s.id) ?? null,
      isEnabledByUser: (map.get(s.id) as any)?.isEnabled ?? false,
    }));
  }

  async findOne(id: string) {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new NotFoundException(`Strategy ${id} not found`);
    return strategy;
  }

  async create(dto: CreateStrategyDto) {
    validateStrategyRules(dto.rules);
    return this.prisma.strategy.create({ data: dto });
  }

  async update(id: string, dto: UpdateStrategyDto) {
    await this.findOne(id);
    if (dto.rules) validateStrategyRules(dto.rules);
    return this.prisma.strategy.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.strategy.delete({ where: { id } });
  }

  async toggleUserStrategy(userId: string, strategyId: string, dto: ToggleUserStrategyDto) {
    const strategy = await this.findOne(strategyId);
    if (dto.isEnabled && !strategy.isActive) {
      throw new BadRequestException('Cette stratégie a été désactivée par un administrateur.');
    }
    if (dto.customRules) validateStrategyRules(dto.customRules);
    if (dto.isEnabled) {
      const existing = await this.prisma.userStrategy.findUnique({
        where: { userId_strategyId: { userId, strategyId } },
      });
      if (!existing?.isEnabled) await this.quota.assertCanEnableStrategy(userId);
    }
    return this.prisma.userStrategy.upsert({
      where: { userId_strategyId: { userId, strategyId } },
      create: { userId, strategyId, isEnabled: dto.isEnabled, customRules: dto.customRules },
      update: { isEnabled: dto.isEnabled, customRules: dto.customRules },
    });
  }

  async getUserStrategies(userId: string) {
    return this.prisma.userStrategy.findMany({
      where: { userId },
      include: { strategy: true },
    });
  }

  async updateUserStrategy(userId: string, strategyId: string, customRules: any, isEnabled?: boolean) {
    if (customRules) validateStrategyRules(customRules);
    const existing = await this.prisma.userStrategy.findUnique({
      where: { userId_strategyId: { userId, strategyId } },
    });
    if (!existing) throw new NotFoundException('UserStrategy not found');
    return this.prisma.userStrategy.update({
      where: { userId_strategyId: { userId, strategyId } },
      data: { customRules, isEnabled },
      include: { strategy: true },
    });
  }

  async removeUserStrategy(userId: string, strategyId: string) {
    const existing = await this.prisma.userStrategy.findUnique({
      where: { userId_strategyId: { userId, strategyId } },
    });
    if (!existing) throw new NotFoundException('UserStrategy not found');
    return this.prisma.userStrategy.delete({
      where: { userId_strategyId: { userId, strategyId } },
    });
  }

  async fromText(description: string, save = false, userId?: string) {
    if (!description || description.trim().length < 10) {
      throw new BadRequestException('Description trop courte (min 10 caractères)');
    }

    const result = await this.engine.post('/llm/strategy-from-text', {
      description: description.trim(),
      language: 'fr',
    }, { timeout: 120_000, maxRetries: 0 });

    if (result.error) {
      throw new BadRequestException(`LLM n'a pas pu générer une stratégie valide: ${result.error}`);
    }

    const rules = result.rules;
    const name = result.name || 'Generated Strategy';
    const desc = result.description || description.slice(0, 200);

    // Validate the generated rules
    try {
      validateStrategyRules(rules);
    } catch (e: any) {
      // Return the raw rules with validation errors so the user can adjust
      return {
        saved: false,
        name,
        description: desc,
        rules,
        validationErrors: e.response?.errors ?? [e.message],
        provider: result.provider,
        model: result.model,
      };
    }

    if (!save) {
      return {
        saved: false,
        name,
        description: desc,
        rules,
        provider: result.provider,
        model: result.model,
      };
    }

    // Save to DB
    const strategy = await this.prisma.strategy.create({
      data: {
        name,
        description: desc,
        rules,
        analysisTimeframe: rules.analysis_timeframe ?? null,
        entryTimeframe: rules.entry_timeframe ?? null,
        isActive: false, // Admin must activate manually
      },
    });

    return {
      saved: true,
      strategy,
      provider: result.provider,
      model: result.model,
    };
  }

  async getStats() {
    const [total, active] = await Promise.all([
      this.prisma.strategy.count(),
      this.prisma.strategy.count({ where: { isActive: true } }),
    ]);
    return { total, active };
  }

  async getStrategyPerformance() {
    const strategies = await this.prisma.strategy.findMany({
      include: {
        signals: {
          where: { isActive: false },
          select: {
            id: true,
            signal: true,
            confidence: true,
            createdAt: true,
            asset: { select: { symbol: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        },
      },
    });

    const result = await Promise.all(
      strategies.map(async (s) => {
        const positions = await this.prisma.position.findMany({
          where: { signal: { strategyId: s.id }, status: 'CLOSED' },
          select: {
            pnl: true,
            pnlPercent: true,
            direction: true,
            openedAt: true,
            closedAt: true,
          },
        });

        const totalPnl = positions.reduce(
          (sum, p) => sum + parseFloat((p.pnl ?? 0).toString()),
          0,
        );
        const wins = positions.filter(p => parseFloat((p.pnl ?? 0).toString()) > 0).length;
        const losses = positions.filter(p => parseFloat((p.pnl ?? 0).toString()) <= 0).length;
        const winRate = positions.length > 0 ? (wins / positions.length) * 100 : 0;
        const avgPnlPct = positions.length > 0
          ? positions.reduce((sum, p) => sum + parseFloat((p.pnlPercent ?? 0).toString()), 0) / positions.length
          : 0;

        const signalCount = s.signals.length;
        const buyCount = s.signals.filter(sig => sig.signal === 'BUY').length;
        const sellCount = s.signals.filter(sig => sig.signal === 'SELL').length;
        const avgConfidence = signalCount > 0
          ? s.signals.reduce((sum, sig) => sum + parseFloat(sig.confidence.toString()), 0) / signalCount
          : 0;

        return {
          strategyId: s.id,
          name: s.name,
          isActive: s.isActive,
          signalsGenerated: signalCount,
          buyCount,
          sellCount,
          avgConfidence: parseFloat(avgConfidence.toFixed(1)),
          tradesClosed: positions.length,
          wins,
          losses,
          winRate: parseFloat(winRate.toFixed(1)),
          totalPnl: parseFloat(totalPnl.toFixed(2)),
          avgPnlPct: parseFloat(avgPnlPct.toFixed(2)),
        };
      }),
    );

    return result.sort((a, b) => b.totalPnl - a.totalPnl);
  }
}
