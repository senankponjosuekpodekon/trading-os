import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { PositionsService } from '../positions/positions.service';
import { JournalService } from '../journal/journal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { retryWithBackoff } from '../utils/retry';

const BINANCE_PRICES = 'https://api.binance.com/api/v3/ticker/price';
const SYM_MAP: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT',
  'SOL/USDT': 'SOLUSDT', 'BNB/USDT': 'BNBUSDT',
};

@Injectable()
export class WatcherService {
  private readonly logger = new Logger(WatcherService.name);

  constructor(
    private prisma: PrismaService,
    private positions: PositionsService,
    private journal: JournalService,
    private http: HttpService,
    private notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async watchPositions() {
    const openPositions = await this.prisma.position.findMany({
      where: { status: 'OPEN' },
      include: {
        asset:     { select: { symbol: true } },
        portfolio: { select: { userId: true } },
      },
    });

    if (openPositions.length === 0) return;

    // Récupérer tous les prix en une seule requête
    const symbols = [...new Set(openPositions.map(p => SYM_MAP[p.asset.symbol]).filter(Boolean))];
    let prices: Record<string, number> = {};

    try {
      const data = await retryWithBackoff(
        async () => {
          const { data: resp } = await firstValueFrom(
            this.http.get<{ symbol: string; price: string }[]>(BINANCE_PRICES, { timeout: 5000 }),
          );
          return resp;
        },
        {
          maxRetries: 3,
          baseDelayMs: 500,
          onRetry: (attempt, err) =>
            this.logger.warn(`Watcher: échec récupération prix Binance (tentative ${attempt}) — ${err.message}`),
        },
      );
      prices = Object.fromEntries(
        data
          .filter(d => symbols.includes(d.symbol))
          .map(d => [d.symbol, parseFloat(d.price)]),
      );
    } catch (err) {
      this.logger.error('Watcher: impossible de récupérer les prix Binance après 3 tentatives');
      return;
    }

    let closed = 0;

    for (const pos of openPositions) {
      const binSym = SYM_MAP[pos.asset.symbol];
      if (!binSym) continue;

      const livePrice = prices[binSym];
      if (!livePrice) continue;

      const entry = parseFloat(pos.entryPrice.toString());
      const sl    = pos.stopLoss   ? parseFloat(pos.stopLoss.toString())   : null;
      const tp    = pos.takeProfit ? parseFloat(pos.takeProfit.toString()) : null;

      let triggered: 'SL' | 'TP' | null = null;

      if (pos.direction === 'BUY') {
        if (sl && livePrice <= sl) triggered = 'SL';
        if (tp && livePrice >= tp) triggered = 'TP';
      } else {
        if (sl && livePrice >= sl) triggered = 'SL';
        if (tp && livePrice <= tp) triggered = 'TP';
      }

      if (!triggered) continue;

      const result = await this.positions.closeByWatcher(pos.id, livePrice, triggered);
      if (!result) continue;

      closed++;
      const pnlNum = parseFloat(result.pnl);
      this.logger.log(
        `Watcher: ${pos.asset.symbol} ${triggered} @ ${livePrice} | PnL ${result.pnl}`,
      );

      this.notifications.push({
        userId: pos.portfolio.userId,
        type: 'POSITION',
        title: `${triggered} touché — ${pos.asset.symbol}`,
        message: `Position ${pos.direction} fermée à ${livePrice} | PnL ${pnlNum > 0 ? '+' : ''}${pnlNum.toFixed(2)}`,
        data: { positionId: pos.id, symbol: pos.asset.symbol, triggered, pnl: pnlNum },
      });

      // Enregistrement automatique dans le journal (J19)
      try {
        await this.journal.createAuto({
          userId:    pos.portfolio.userId,
          assetSymbol: pos.asset.symbol,
          direction: pos.direction,
          entryPrice: entry,
          exitPrice:  livePrice,
          pnl:        parseFloat(result.pnl),
          pnlPct:     parseFloat(result.pnlPercent),
          closeReason: triggered,
          positionId:  pos.id,
        });
      } catch (e) {
        this.logger.warn(`Watcher: journal auto failed for ${pos.id}`);
      }
    }

    if (closed > 0) {
      this.logger.log(`Watcher: ${closed} position(s) fermée(s) automatiquement`);
    }
  }
}
