import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { PositionsService } from '../positions/positions.service';
import { JournalService } from '../journal/journal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceAlertsService } from '../price-alerts/price-alerts.service';
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
    private priceAlerts: PriceAlertsService,
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
    } catch {
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
      } catch {
        this.logger.warn(`Watcher: journal auto failed for ${pos.id}`);
      }
    }

    if (closed > 0) {
      this.logger.log(`Watcher: ${closed} position(s) fermée(s) automatiquement`);
    }

    // Vérifier les alertes prix pour les symboles surveillés
    const BINANCE_TO_INTERNAL = Object.fromEntries(
      Object.entries(SYM_MAP).map(([internal, binance]) => [binance, internal]),
    );
    const internalPrices = Object.fromEntries(
      Object.entries(prices).map(([binSym, price]) => [BINANCE_TO_INTERNAL[binSym] ?? binSym, price]),
    );
    try {
      await this.priceAlerts.checkAlerts(internalPrices);
    } catch (e: any) {
      this.logger.warn(`Watcher: price alert check failed — ${e?.message}`);
    }
  }

  // Sprint 3 — Cycle de vie PENDING → ACTIVE / INVALIDATED pour les setups RETEST/LIMIT.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async watchPendingSignals() {
    const now = new Date();

    // Setups expirés avant d'avoir été déclenchés → INVALIDATED
    const expired = await this.prisma.signal.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      data: { status: 'INVALIDATED' },
    });
    if (expired.count > 0) {
      this.logger.log(`Watcher: ${expired.count} signal(s) PENDING invalidé(s) (expiré)`);
    }

    const pending = await this.prisma.signal.findMany({
      where: { status: 'PENDING', expiresAt: { gte: now } },
      include: { asset: { select: { symbol: true } } },
    });
    if (pending.length === 0) return;

    const symbols = [...new Set(pending.map(s => SYM_MAP[s.asset.symbol]).filter(Boolean))];
    if (symbols.length === 0) return;

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
            this.logger.warn(`Watcher: échec récupération prix (pending signals, tentative ${attempt}) — ${err.message}`),
        },
      );
      prices = Object.fromEntries(
        data.filter(d => symbols.includes(d.symbol)).map(d => [d.symbol, parseFloat(d.price)]),
      );
    } catch {
      this.logger.error('Watcher: impossible de récupérer les prix pour les signaux PENDING');
      return;
    }

    let activated = 0;
    for (const sig of pending) {
      const binSym = SYM_MAP[sig.asset.symbol];
      if (!binSym) continue;
      const livePrice = prices[binSym];
      if (!livePrice || !sig.entryPrice) continue;

      const entry = parseFloat(sig.entryPrice.toString());
      // RETEST/LIMIT : le setup s'active quand le prix atteint (ou dépasse) le niveau d'entrée
      // dans le sens favorable — BUY veut acheter au niveau ou plus bas, SELL au niveau ou plus haut.
      const triggered =
        (sig.signal === 'BUY' && livePrice <= entry) ||
        (sig.signal === 'SELL' && livePrice >= entry);
      if (!triggered) continue;

      await this.prisma.signal.update({ where: { id: sig.id }, data: { status: 'ACTIVE' } });
      activated++;
    }

    if (activated > 0) {
      this.logger.log(`Watcher: ${activated} signal(s) PENDING activé(s)`);
    }
  }
}
