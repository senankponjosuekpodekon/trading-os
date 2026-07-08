import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private ai: AiService,
    private prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return this.ai.health();
  }

  @Post('explain/signal/:signalId')
  async explainSignal(@Param('signalId') signalId: string) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { asset: true },
    });
    if (!signal) return { error: 'Signal not found' };

    const payload = {
      symbol:      signal.asset.symbol,
      timeframe:   signal.timeframe,
      signal:      signal.signal,
      confidence:  parseFloat(signal.confidence.toString()),
      explanation: signal.explanation ?? '',
      indicators:  (signal.metadata as any)?.indicators ?? {},
      price_action: (signal.metadata as any)?.price_action ?? null,
      regime:      (signal.metadata as any)?.regime ?? null,
      smc:         (signal.metadata as any)?.smc ?? null,
      language:    'fr',
    };

    return this.ai.explainSignal(payload);
  }

  @Post('explain')
  explainRaw(@Body() body: any) {
    return this.ai.explainSignal({ ...body, language: body.language ?? 'fr' });
  }

  @Post('weekly-report')
  weeklyReport(@Body() body: any) {
    return this.ai.weeklyReport(body);
  }
}
