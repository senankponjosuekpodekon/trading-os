import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaSystemService } from '../prisma/prisma.service';
import { HybridCandleRepository } from '../signals/hybrid-candle.repository';
import { CronConfigService } from './cron-config.service';
import { AUTOPILOT_EMAIL } from '../signals/auto-trader.service';

// Rafraîchit les bougies 1m des symboles avec position AutoPilot ouverte :
// le snapshot admin n'utilise que des marks persistés (bougie 1m close de
// 1-5 min), donc sans fetch périodique le P&L latent reste "indisponible".
// Ne gère jamais les positions — lecture de marché + stockage candles.
const MARKS_LOOKBACK_MS = 10 * 60_000;

@Injectable()
export class AutopilotMarksScheduler {
  private readonly logger = new Logger(AutopilotMarksScheduler.name);
  private running = false;

  constructor(
    private prisma: PrismaSystemService,
    private candles: HybridCandleRepository,
    private cronConfig: CronConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async refresh(): Promise<void> {
    if (this.running) return;
    if (!(await this.cronConfig.isEnabled('AUTOPILOT_MARKS_ENABLED'))) return;
    this.running = true;
    try {
      const positions = await this.prisma.position.findMany({
        where: {
          status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] },
          portfolio: { name: 'AutoPilot', type: 'PAPER', user: { email: AUTOPILOT_EMAIL } },
        },
        select: { asset: { select: { symbol: true } } },
      });
      const since = new Date(Date.now() - MARKS_LOOKBACK_MS);
      for (const symbol of new Set(positions.map(p => p.asset.symbol))) {
        try {
          await this.candles.getSince(symbol, '1m', since);
        } catch (error) {
          this.logger.warn(`1m marks refresh failed for ${symbol}: ${(error as Error)?.message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
