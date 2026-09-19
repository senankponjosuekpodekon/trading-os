import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SignalExecutionEventType, IntrabarResolutionMethod } from '@prisma/client';

export interface CreateExecutionEventInput {
  signalId: string;
  type: SignalExecutionEventType;
  price: number;
  sizePct?: number;
  candleTime: Date;
  candleTimeframe: string;
  resolvedBy?: IntrabarResolutionMethod;
  metadata?: any;
}

@Injectable()
export class SignalExecutionService {
  private readonly logger = new Logger(SignalExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async logEvent(input: CreateExecutionEventInput) {
    const event = await this.prisma.signalExecutionEvent.create({
      data: {
        signalId: input.signalId,
        type: input.type,
        price: input.price,
        sizePct: input.sizePct ?? 100,
        candleTime: input.candleTime,
        candleTimeframe: input.candleTimeframe,
        resolvedBy: input.resolvedBy ?? 'CANDLE_CLOSE',
        metadata: input.metadata ?? undefined,
      },
    });

    // Notify on SL/TP hits, ENTRY_HIT, EXPIRED — non-blocking, don't break the event log
    const notifyTypes = ['SL_HIT', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'ENTRY_HIT', 'EXPIRED'];
    if (notifyTypes.includes(input.type)) {
      try {
        const signal = await this.prisma.signal.findUnique({
          where: { id: input.signalId },
          include: { asset: true },
        });
        if (signal) {
          const labels: Record<string, string> = {
            SL_HIT: 'SL touché',
            TP1_HIT: 'TP1 touché',
            TP2_HIT: 'TP2 touché',
            TP3_HIT: 'TP3 touché',
            ENTRY_HIT: 'Entrée touchée',
            EXPIRED: 'Signal expiré',
          };
          await this.notifications.push({
            userId: '*',
            type: 'SIGNAL',
            title: `${labels[input.type]} — ${signal.asset.symbol}`,
            message: `${signal.signal} ${signal.asset.symbol} : ${input.type.replace('_', ' ')} à ${input.price}`,
            data: { signalId: signal.id, type: input.type, price: input.price },
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to send notification for ${input.type} on signal ${input.signalId}`, error as Error);
      }
    }

    return event;
  }

  async getTimeline(signalId: string) {
    return this.prisma.signalExecutionEvent.findMany({
      where: { signalId },
      orderBy: { candleTime: 'asc' },
    });
  }
}
