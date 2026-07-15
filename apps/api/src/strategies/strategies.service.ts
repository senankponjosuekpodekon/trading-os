import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStrategyDto, UpdateStrategyDto, ToggleUserStrategyDto } from './dto/create-strategy.dto';
import { validateStrategyRules } from './rules-validator';

@Injectable()
export class StrategiesService {
  constructor(private prisma: PrismaService) {}

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
    await this.findOne(strategyId);
    if (dto.customRules) validateStrategyRules(dto.customRules);
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

  async getStats() {
    const [total, active] = await Promise.all([
      this.prisma.strategy.count(),
      this.prisma.strategy.count({ where: { isActive: true } }),
    ]);
    return { total, active };
  }
}
