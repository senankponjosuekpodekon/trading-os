import { Injectable } from '@nestjs/common';
import { Prisma, PositionStatus } from '@prisma/client';
import { PrismaSystemService } from '../prisma/prisma.service';
import { AUTOPILOT_EMAIL } from '../signals/auto-trader.service';
import { MaintenanceService } from './maintenance.service';

const openStatuses: PositionStatus[] = ['OPEN', 'PARTIAL', 'PARTIAL_2'];
const numberOrNull = (value: unknown): number | null => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const positionSelect = {
  id: true, signalId: true, status: true, direction: true, entryPrice: true,
  exitPrice: true, quantity: true, originalQuantity: true, stopLoss: true,
  takeProfit: true, takeProfit2: true, takeProfit3: true, pnl: true,
  partialExitAt: true, partialExitPrice: true, partialPnl: true,
  secondPartialExitAt: true, secondPartialExitPrice: true, secondPartialPnl: true,
  openedAt: true, closedAt: true, asset: { select: { symbol: true } },
} satisfies Prisma.PositionSelect;

@Injectable()
export class AutopilotReadService {
  constructor(private prisma: PrismaSystemService, private maintenance: MaintenanceService) {}

  async snapshot() {
    const enabled = await this.maintenance.isAutoTraderEnabled();
    return this.prisma.$transaction(async db => {
      const checkedAt = new Date();
      const [portfolio, signals, statuses, lastAttempt] = await Promise.all([
        db.portfolio.findFirst({
          where: { name: 'AutoPilot', type: 'PAPER', user: { email: AUTOPILOT_EMAIL } },
          select: { id: true, name: true, type: true, currency: true, initialCapital: true, currentCapital: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        db.signal.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
          select: {
            id: true, signal: true, confidence: true, executionStatus: true, createdAt: true,
            asset: { select: { symbol: true } },
            executionEvents: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10,
              select: {
                id: true, type: true, candleTime: true, createdAt: true, metadata: true,
                autopilotStatus: true, autopilotAttempts: true, autopilotLastAttemptAt: true,
                autopilotProcessedAt: true, autopilotNextAttemptAt: true, autopilotLastError: true,
              },
            },
          },
        }),
        db.signalExecutionEvent.groupBy({ by: ['autopilotStatus'], _count: { _all: true } }),
        db.signalExecutionEvent.findFirst({
          where: { autopilotLastAttemptAt: { not: null } },
          orderBy: { autopilotLastAttemptAt: 'desc' }, select: { autopilotLastAttemptAt: true },
        }),
      ]);
      const base = {
        mode: 'PAPER' as const, readOnly: true as const, executionEnabled: false as const, checkedAt,
        worker: {
          enabled, statusCounts: Object.fromEntries(statuses.map(s => [s.autopilotStatus, s._count._all])),
          lastAttemptAt: lastAttempt?.autopilotLastAttemptAt ?? null,
        },
        signals: signals.map(s => ({
          id: s.id, symbol: s.asset.symbol, direction: s.signal, confidence: s.confidence,
          executionStatus: s.executionStatus, createdAt: s.createdAt,
          events: s.executionEvents.map(e => {
            const metadata = e.metadata as { autopilot?: { reason?: unknown } } | null;
            return {
              id: e.id, type: e.type, candleTime: e.candleTime, createdAt: e.createdAt,
              status: e.autopilotStatus, attempts: e.autopilotAttempts,
              lastAttemptAt: e.autopilotLastAttemptAt, processedAt: e.autopilotProcessedAt,
              nextAttemptAt: e.autopilotNextAttemptAt,
              reason: typeof metadata?.autopilot?.reason === 'string' ? metadata.autopilot.reason : e.autopilotLastError,
            };
          }),
        })),
      };
      if (!portfolio) return { ...base, portfolio: null };
      const where = { portfolioId: portfolio.id };
      const [open, closed, totals, closedCount] = await Promise.all([
        db.position.findMany({ where: { ...where, status: { in: openStatuses } }, select: positionSelect, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }] }),
        db.position.findMany({ where: { ...where, status: 'CLOSED' }, select: positionSelect, orderBy: [{ closedAt: 'desc' }, { id: 'desc' }], take: 50 }),
        db.position.aggregate({ where, _sum: { pnl: true } }),
        db.position.count({ where: { ...where, status: 'CLOSED' } }),
      ]);
      const symbols = [...new Set(open.map(p => p.asset.symbol))];
      const marks = new Map(await Promise.all(symbols.map(async symbol => {
        const candle = await db.candle.findFirst({
          where: { symbol, timeframe: '1m', openTime: { gte: new Date(checkedAt.getTime() - 300000), lte: new Date(checkedAt.getTime() - 60000) } },
          orderBy: { openTime: 'desc' }, select: { close: true, openTime: true },
        });
        const price = numberOrNull(candle?.close);
        const age = candle ? checkedAt.getTime() - candle.openTime.getTime() : NaN;
        return [symbol, price !== null && price > 0 && age >= 60000 && age <= 300000
          ? { price, at: new Date(candle!.openTime.getTime() + 60000) } : null] as const;
      })));
      const serialize = (p: Prisma.PositionGetPayload<{ select: typeof positionSelect }>) => {
        const entry = numberOrNull(p.entryPrice);
        const quantity = numberOrNull(p.quantity);
        const mark = openStatuses.includes(p.status) ? marks.get(p.asset.symbol) ?? null : null;
        const unrealizedPnl = mark && entry !== null && entry > 0 && quantity !== null && quantity >= 0 && ['BUY', 'SELL'].includes(p.direction)
          ? (mark.price - entry) * quantity * (p.direction === 'BUY' ? 1 : -1) : null;
        return {
          id: p.id, signalId: p.signalId, symbol: p.asset.symbol, status: p.status, direction: p.direction,
          entryPrice: entry, quantity, originalQuantity: numberOrNull(p.originalQuantity),
          stopLoss: numberOrNull(p.stopLoss), takeProfit: numberOrNull(p.takeProfit),
          takeProfit2: numberOrNull(p.takeProfit2), takeProfit3: numberOrNull(p.takeProfit3),
          realizedPnl: numberOrNull(p.pnl), unrealizedPnl, mark: mark?.price ?? null,
          markAt: mark?.at ?? null, priceSource: mark ? 'CANDLE_1M_CLOSE' : null,
          partialExitAt: p.partialExitAt, partialExitPrice: numberOrNull(p.partialExitPrice), partialPnl: numberOrNull(p.partialPnl),
          secondPartialExitAt: p.secondPartialExitAt, secondPartialExitPrice: numberOrNull(p.secondPartialExitPrice), secondPartialPnl: numberOrNull(p.secondPartialPnl),
          openedAt: p.openedAt, closedAt: p.closedAt, exitPrice: numberOrNull(p.exitPrice),
        };
      };
      const positions = open.map(serialize);
      const unrealizedPnl = positions.some(p => p.unrealizedPnl === null) ? null : positions.reduce((sum, p) => sum + p.unrealizedPnl!, 0);
      const currentCapital = Number(portfolio.currentCapital);
      const initialCapital = Number(portfolio.initialCapital);
      const realizedPnl = Number(totals._sum.pnl ?? 0);
      const riskToStop = positions.some(p => p.entryPrice === null || p.quantity === null || p.stopLoss === null)
        ? null : positions.reduce((sum, p) => sum + p.quantity! * Math.max(0, (p.entryPrice! - p.stopLoss!) * (p.direction === 'BUY' ? 1 : -1)), 0);
      return {
        ...base,
        portfolio: {
          id: portfolio.id, name: portfolio.name, currency: portfolio.currency,
          initialCapital, currentCapital, realizedPnl, unrealizedPnl,
          equity: unrealizedPnl === null ? null : currentCapital + unrealizedPnl,
          accountingDifference: currentCapital - initialCapital - realizedPnl,
          riskToStop, positions, closedPositions: closed.map(serialize), closedCount,
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  }
}
