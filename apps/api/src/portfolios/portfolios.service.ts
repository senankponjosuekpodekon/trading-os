import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../billing/quota.service';
import { CreatePortfolioDto } from './dto/create-portfolio.dto';

@Injectable()
export class PortfoliosService {
  constructor(
    private prisma: PrismaService,
    private quota: QuotaService,
  ) {}

  async findByUser(userId: string) {
    return this.prisma.portfolio.findMany({
      where: { userId },
      include: { positions: { where: { status: 'OPEN' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreatePortfolioDto) {
    await this.quota.assertCanCreatePortfolio(userId);
    const capital = dto.initialCapital ?? 10000;
    return this.prisma.portfolio.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        currency: dto.currency ?? 'USD',
        initialCapital: capital,
        currentCapital: capital,
      },
    });
  }
}
