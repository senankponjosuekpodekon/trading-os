import { Injectable } from '@nestjs/common';
import { IsString, IsOptional, IsInt, IsArray, Min, Max, MaxLength, ArrayMaxSize } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateJournalDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  emotion?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  grade?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  tags?: string[];

  @IsOptional()
  @IsString()
  positionId?: string;
}

@Injectable()
export class JournalService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateJournalDto) {
    return this.prisma.journalEntry.create({
      data: {
        userId,
        title: dto.title,
        content: dto.content,
        emotion: dto.emotion,
        grade: dto.grade,
        tags: dto.tags ?? [],
        positionId: dto.positionId,
      },
    });
  }

  async findAll(userId: string, opts: { page: number; limit: number; sort: string }) {
    const [field, dir] = opts.sort.split(':');
    const orderByField = ['createdAt', 'grade'].includes(field) ? field : 'createdAt';
    const orderBy: any = { [orderByField]: dir === 'asc' ? 'asc' : 'desc' };
    const skip = (opts.page - 1) * opts.limit;

    const where = { userId };

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        skip,
        take: opts.limit,
        orderBy,
        include: {
          position: {
            include: { asset: { select: { symbol: true } } },
          },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: opts.page,
        limit: opts.limit,
        total,
        totalPages: Math.ceil(total / opts.limit),
      },
    };
  }

  async findOne(userId: string, id: string) {
    return this.prisma.journalEntry.findFirst({
      where: { id, userId },
      include: {
        position: { include: { asset: { select: { symbol: true, name: true } } } },
      },
    });
  }

  async createAuto(params: {
    userId:      string;
    assetSymbol: string;
    direction:   string;
    entryPrice:  number;
    exitPrice:   number;
    pnl:         number;
    pnlPct:      number;
    closeReason: string;
    positionId:  string;
  }) {
    const win   = params.pnl > 0;
    const emoji = win ? '✅' : '❌';
    return this.prisma.journalEntry.create({
      data: {
        userId:     params.userId,
        positionId: params.positionId,
        title:      `${emoji} ${params.direction} ${params.assetSymbol} — fermé (${params.closeReason})`,
        content:    `Trade fermé automatiquement par le watcher.\n\nEntry: $${params.entryPrice}\nExit: $${params.exitPrice}\nPnL: ${params.pnl >= 0 ? '+' : ''}$${params.pnl.toFixed(2)} (${params.pnlPct.toFixed(2)}%)\nRaison: ${params.closeReason}`,
        emotion:    win ? 'SATISFIED' : 'NEUTRAL',
        grade:      win ? (params.pnlPct > 2 ? 5 : 4) : (params.closeReason === 'SL' ? 2 : 3),
        tags:       ['auto', params.closeReason.toLowerCase(), win ? 'win' : 'loss'],
      },
    });
  }

  async getStats(userId: string) {
    const entries = await this.prisma.journalEntry.findMany({ where: { userId } });
    const withGrade = entries.filter(e => e.grade != null);
    const avgGrade = withGrade.length > 0
      ? withGrade.reduce((s, e) => s + (e.grade ?? 0), 0) / withGrade.length
      : null;

    const emotions: Record<string, number> = {};
    for (const e of entries) {
      if (e.emotion) emotions[e.emotion] = (emotions[e.emotion] ?? 0) + 1;
    }

    return { total: entries.length, avgGrade, emotions };
  }
}
