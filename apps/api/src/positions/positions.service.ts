import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePositionDto } from './dto/create-position.dto';

const BINANCE_TICKER = 'https://api.binance.com/api/v3/ticker/price';
const SYM_MAP: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT',
  'SOL/USDT': 'SOLUSDT', 'BNB/USDT': 'BNBUSDT',
};

@Injectable()
export class PositionsService {
  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {}

  private async fetchLivePrice(symbol: string): Promise<number | null> {
    const binSym = SYM_MAP[symbol];
    if (!binSym) return null;
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ price: string }>(BINANCE_TICKER, { params: { symbol: binSym } }),
      );
      return parseFloat(data.price);
    } catch {
      return null;
    }
  }

  async create(userId: string, dto: CreatePositionDto) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: dto.portfolioId, userId },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    const asset = await this.prisma.asset.findUnique({ where: { symbol: dto.assetSymbol } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetSymbol} not found`);

    const cost = dto.entryPrice * dto.quantity;
    const capital = parseFloat(portfolio.currentCapital.toString());
    if (cost > capital) throw new BadRequestException('Insufficient capital');

    const [position] = await this.prisma.$transaction([
      this.prisma.position.create({
        data: {
          portfolioId: dto.portfolioId,
          assetId: asset.id,
          direction: dto.direction as any,
          entryPrice: dto.entryPrice,
          quantity: dto.quantity,
          stopLoss: dto.stopLoss,
          takeProfit: dto.takeProfit,
          signalId: dto.signalId,
          status: 'OPEN',
        },
        include: { asset: { select: { symbol: true, name: true } } },
      }),
      this.prisma.portfolio.update({
        where: { id: dto.portfolioId },
        data: { currentCapital: { decrement: cost } },
      }),
    ]);

    return position;
  }

  async findByPortfolio(userId: string, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: portfolioId, userId },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    return this.prisma.position.findMany({
      where: { portfolioId },
      orderBy: { openedAt: 'desc' },
      include: { asset: { select: { symbol: true, name: true } } },
    });
  }

  async close(userId: string, positionId: string, exitPrice: number) {
    const position = await this.prisma.position.findFirst({
      where: { id: positionId, status: 'OPEN', portfolio: { userId } },
      include: { portfolio: true },
    });
    if (!position) throw new NotFoundException('Position not found or already closed');

    const entry  = parseFloat(position.entryPrice.toString());
    const qty    = parseFloat(position.quantity.toString());
    const pnl    = position.direction === 'BUY'
      ? (exitPrice - entry) * qty
      : (entry - exitPrice) * qty;
    const pnlPct = ((pnl / (entry * qty)) * 100);
    const proceeds = exitPrice * qty;

    await this.prisma.$transaction([
      this.prisma.position.update({
        where: { id: positionId },
        data: {
          status: 'CLOSED',
          exitPrice,
          pnl,
          pnlPercent: pnlPct,
          closedAt: new Date(),
        },
      }),
      this.prisma.portfolio.update({
        where: { id: position.portfolioId },
        data: { currentCapital: { increment: proceeds + pnl } },
      }),
    ]);

    return { positionId, exitPrice, pnl: pnl.toFixed(2), pnlPercent: pnlPct.toFixed(2) };
  }

  async getSummary(userId: string, portfolioId?: string) {
    let resolvedId = portfolioId;
    if (!resolvedId || resolvedId === 'ALL') {
      const first = await this.prisma.portfolio.findFirst({ where: { userId } });
      if (!first) return { open: 0, closed: 0, totalPnl: 0, winRate: 0, positions: [] };
      resolvedId = first.id;
    }
    const positions = await this.findByPortfolio(userId, resolvedId!);
    const open   = positions.filter(p => p.status === 'OPEN');
    const closed = positions.filter(p => p.status === 'CLOSED');
    const totalPnl = closed.reduce((sum, p) => sum + parseFloat((p.pnl ?? 0).toString()), 0);
    const winRate  = closed.length > 0
      ? (closed.filter(p => parseFloat((p.pnl ?? 0).toString()) > 0).length / closed.length) * 100
      : 0;

    return { open: open.length, closed: closed.length, totalPnl, winRate, positions };
  }

  async getLivePositions(userId: string, portfolioId?: string) {
    let resolvedId = portfolioId;
    if (!resolvedId || resolvedId === 'ALL') {
      const first = await this.prisma.portfolio.findFirst({ where: { userId } });
      if (!first) return [];
      resolvedId = first.id;
    }

    const openPositions = await this.prisma.position.findMany({
      where: { portfolioId: resolvedId, status: 'OPEN', portfolio: { userId } },
      include: { asset: { select: { symbol: true, name: true } } },
      orderBy: { openedAt: 'desc' },
    });

    const withLive = await Promise.all(
      openPositions.map(async (pos) => {
        const livePrice = await this.fetchLivePrice(pos.asset.symbol);
        if (!livePrice) return { ...pos, livePrice: null, unrealizedPnl: null, unrealizedPct: null };

        const entry = parseFloat(pos.entryPrice.toString());
        const qty   = parseFloat(pos.quantity.toString());
        const unrealizedPnl = pos.direction === 'BUY'
          ? (livePrice - entry) * qty
          : (entry - livePrice) * qty;
        const unrealizedPct = (unrealizedPnl / (entry * qty)) * 100;

        return {
          ...pos,
          livePrice,
          unrealizedPnl: parseFloat(unrealizedPnl.toFixed(2)),
          unrealizedPct: parseFloat(unrealizedPct.toFixed(2)),
          slDistance:    pos.stopLoss   ? Math.abs(livePrice - parseFloat(pos.stopLoss.toString())) : null,
          tpDistance:    pos.takeProfit ? Math.abs(parseFloat(pos.takeProfit.toString()) - livePrice) : null,
        };
      }),
    );

    return withLive;
  }

  async openFromSignal(userId: string, signalId: string) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { asset: true },
    });
    if (!signal) throw new NotFoundException('Signal not found');
    if (signal.signal === 'NEUTRAL') throw new BadRequestException('Cannot open position on NEUTRAL signal');

    const portfolio = await this.prisma.portfolio.findFirst({ where: { userId } });
    if (!portfolio) throw new NotFoundException('No portfolio found');

    const capital    = parseFloat(portfolio.currentCapital.toString());
    const riskAmt    = capital * 0.01;
    const entryPrice = signal.entryPrice ? parseFloat(signal.entryPrice.toString()) : null;
    if (!entryPrice) throw new BadRequestException('Signal has no entry price');

    const slPrice = signal.stopLoss ? parseFloat(signal.stopLoss.toString()) : null;
    const slDist  = slPrice ? Math.abs(entryPrice - slPrice) : entryPrice * 0.01;
    const qty     = parseFloat((riskAmt / slDist).toFixed(6));
    const cost    = entryPrice * qty;
    if (cost > capital) throw new BadRequestException('Insufficient capital');

    const [position] = await this.prisma.$transaction([
      this.prisma.position.create({
        data: {
          portfolioId: portfolio.id,
          assetId:     signal.assetId,
          direction:   signal.signal as any,
          entryPrice,
          quantity:    qty,
          stopLoss:    slPrice,
          takeProfit:  signal.takeProfit1 ? parseFloat(signal.takeProfit1.toString()) : null,
          signalId,
          status:      'OPEN',
        },
        include: { asset: { select: { symbol: true, name: true } } },
      }),
      this.prisma.portfolio.update({
        where: { id: portfolio.id },
        data:  { currentCapital: { decrement: cost } },
      }),
    ]);

    this.notifications.push({
      userId,
      type:    'POSITION',
      title:   `Position ouverte — ${position.asset.symbol}`,
      message: `${signal.signal} ${qty} @ $${entryPrice} | SL: $${slPrice ?? '—'} | TP: $${signal.takeProfit1 ?? '—'}`,
      data:    position,
    });

    return position;
  }

  async closeByWatcher(positionId: string, exitPrice: number, reason: 'SL' | 'TP') {
    const pos = await this.prisma.position.findFirst({
      where: { id: positionId, status: 'OPEN' },
      include: { portfolio: { include: { user: true } }, asset: true },
    });
    if (!pos) return null;

    const entry = parseFloat(pos.entryPrice.toString());
    const qty   = parseFloat(pos.quantity.toString());
    const pnl   = pos.direction === 'BUY' ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;
    const pnlPct = (pnl / (entry * qty)) * 100;

    await this.prisma.$transaction([
      this.prisma.position.update({
        where: { id: positionId },
        data: { status: 'CLOSED', exitPrice, pnl, pnlPercent: pnlPct, closedAt: new Date() },
      }),
      this.prisma.portfolio.update({
        where: { id: pos.portfolioId },
        data:  { currentCapital: { increment: exitPrice * qty } },
      }),
    ]);

    const userId = pos.portfolio.userId;
    this.notifications.push({
      userId,
      type:    'POSITION',
      title:   `Position fermée (${reason}) — ${pos.asset.symbol}`,
      message: `PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
      data:    { positionId, exitPrice, pnl, reason },
    });

    return { positionId, exitPrice, pnl: pnl.toFixed(2), pnlPercent: pnlPct.toFixed(2), reason };
  }
}
