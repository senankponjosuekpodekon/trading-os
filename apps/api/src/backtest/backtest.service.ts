import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RunBacktestDto } from './dto/run-backtest.dto';

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);
  private engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async run(userId: string, dto: RunBacktestDto) {
    const strategy = await this.resolveStrategy(dto, userId);
    const payload: any = { ...dto };
    if (strategy) {
      payload.strategy = strategy;
    }
    delete payload.strategyId;

    const { data } = await firstValueFrom(
      this.http.post(`${this.engineUrl}/backtest/run`, payload),
    );
    return data;
  }

  async runMulti(userId: string, dtos: RunBacktestDto[]) {
    const requests = await Promise.all(
      dtos.map(async (dto) => {
        const strategy = await this.resolveStrategy(dto, userId);
        const payload: any = { ...dto };
        if (strategy) payload.strategy = strategy;
        delete payload.strategyId;
        return payload;
      }),
    );

    const { data } = await firstValueFrom(
      this.http.post(`${this.engineUrl}/backtest/multi`, requests),
    );
    return data;
  }

  private async resolveStrategy(dto: RunBacktestDto, _userId: string) {
    if (dto.strategy) {
      return dto.strategy;
    }
    if (dto.strategyId) {
      const strategy = await this.prisma.strategy.findFirst({
        where: { id: dto.strategyId, isActive: true },
      });
      if (!strategy) {
        throw new NotFoundException(`Strategy ${dto.strategyId} not found or inactive`);
      }
      return {
        id: strategy.id,
        name: strategy.name,
        rules: strategy.rules ?? {},
      };
    }
    return null;
  }
}
