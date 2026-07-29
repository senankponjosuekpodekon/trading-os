import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { rlsContext } from '../prisma/rls-context';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePriceAlertDto } from './dto/create-price-alert.dto';

@Injectable()
export class PriceAlertsService {
  constructor(
    private prisma: PrismaService,
    private systemPrisma: PrismaSystemService,
    private notifications: NotificationsService,
  ) {}

  private get db() {
    return (this.prisma as any).priceAlert;
  }

  async create(userId: string, dto: CreatePriceAlertDto) {
    return this.db.create({
      data: {
        userId,
        assetSymbol: dto.assetSymbol,
        direction: dto.direction,
        targetPrice: dto.targetPrice,
      },
    });
  }

  async findByUser(userId: string) {
    return this.db.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, alertId: string) {
    const alert = await this.db.findFirst({
      where: { id: alertId, userId },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return this.db.delete({ where: { id: alertId } });
  }

  async checkAlerts(prices: Record<string, number>) {
    // Cross-user read: scans every user's pending alerts, must bypass RLS.
    const pending = await this.systemPrisma.priceAlert.findMany({
      where: { triggered: false },
    });

    for (const alert of pending) {
      const price = prices[alert.assetSymbol];
      if (price === undefined) continue;

      const target = parseFloat(String(alert.targetPrice));
      const hit =
        (alert.direction === 'above' && price >= target) ||
        (alert.direction === 'below' && price <= target);

      if (!hit) continue;

      await rlsContext.run(alert.userId, () =>
        this.db.update({
          where: { id: alert.id },
          data: { triggered: true, triggeredAt: new Date() },
        }),
      );

      this.notifications.push({
        userId: alert.userId,
        type: 'ALERT',
        title: `Alerte prix — ${alert.assetSymbol}`,
        message: `${alert.assetSymbol} a atteint ${price} (${alert.direction === 'above' ? 'au-dessus' : 'en-dessous'} de ${target})`,
        data: { alertId: alert.id, symbol: alert.assetSymbol, price, target },
      });
    }
  }
}
