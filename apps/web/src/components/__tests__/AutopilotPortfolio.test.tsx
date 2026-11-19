import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AutopilotPortfolio } from '../AutopilotPortfolio';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/components/signals/SignalTrackingSheet', () => ({
  SignalTrackingSheet: ({ signalId }: { signalId: string }) => <div>Signal lié : {signalId}</div>,
}));
const get = api.get as jest.Mock;
const now = '2026-11-19T12:00:00Z';
const ready = {
  mode: 'PAPER', readOnly: true, executionEnabled: false, checkedAt: now,
  worker: { enabled: true, lastAttemptAt: now, statusCounts: { COMPLETED: 2, SKIPPED: 3 } },
  portfolio: {
    name: 'AutoPilot', currency: 'USD', initialCapital: 10000, currentCapital: 10010,
    realizedPnl: 10, unrealizedPnl: null, equity: null, riskToStop: 100, accountingDifference: 0,
    closedPositions: [], closedCount: 0,
    positions: [{ id: 'position', signalId: 'signal', symbol: 'XRP/USDT', direction: 'BUY', status: 'OPEN',
      entryPrice: 1, quantity: 100, originalQuantity: 150, stopLoss: 0.9, takeProfit: 1.1, takeProfit2: 1.2, takeProfit3: null,
      mark: null, markAt: null, realizedPnl: 10, unrealizedPnl: null, partialExitAt: now, partialExitPrice: 1.1, partialPnl: 10,
      secondPartialExitAt: null, secondPartialExitPrice: null, secondPartialPnl: null, openedAt: now, closedAt: null, exitPrice: null }],
  },
  signals: [{ id: 'signal', symbol: 'XRP/USDT', direction: 'BUY', confidence: 70, executionStatus: 'ACTIVE', createdAt: now,
    events: [{ id: 'event', type: 'ENTRY_HIT', status: 'SKIPPED', reason: 'ASSET_ALREADY_OPEN', attempts: 1, createdAt: now, candleTime: now, processedAt: now, nextAttemptAt: null }] }],
};
beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(now)); get.mockReset(); });
afterEach(() => jest.useRealTimers());

it('shows paper accounting, positions, partials and decisions without broker controls', async () => {
  get.mockResolvedValue({ data: ready });
  await act(async () => { render(<AutopilotPortfolio />); });
  expect(screen.getByText('AutoPilot système — Paper')).toBeInTheDocument();
  expect(screen.getByText('Positions ouvertes (1)')).toBeInTheDocument();
  expect(screen.getByText(/ASSET_ALREADY_OPEN/)).toBeInTheDocument();
  expect(screen.getByText(/TP1 :/)).toBeInTheDocument();
  expect(screen.getAllByText(/Indisponible/).length).toBeGreaterThan(1);
  expect(screen.queryByText('Appliquer')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Voir le signal'));
  expect(screen.getByText('Signal lié : signal')).toBeInTheDocument();
});

it.each([null, {}, { ...ready, executionEnabled: true }, { ...ready, checkedAt: '2026-11-18T12:00:00Z' }])('rejects invalid or outdated snapshots', async data => {
  get.mockResolvedValue({ data });
  await act(async () => { render(<AutopilotPortfolio />); });
  expect(screen.getByRole('status')).toHaveTextContent('indisponible');
  expect(screen.queryByText('Capital initial')).not.toBeInTheDocument();
});

it('clears old balances and stops polling when unmounted', async () => {
  get.mockResolvedValueOnce({ data: ready }).mockRejectedValueOnce(new Error('offline'));
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<AutopilotPortfolio />); });
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(screen.queryByText('Capital initial')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Données précédentes masquées');
  view!.unmount();
  expect(get.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(get).toHaveBeenCalledTimes(2);
});

it('reports an absent system portfolio without pretending it has zero capital', async () => {
  get.mockResolvedValue({ data: { ...ready, portfolio: null } });
  await act(async () => { render(<AutopilotPortfolio />); });
  expect(screen.getByText(/pas encore créé/)).toBeInTheDocument();
  expect(screen.queryByText('Capital initial')).not.toBeInTheDocument();
});

it('warns about accounting discrepancies', async () => {
  get.mockResolvedValue({ data: { ...ready, portfolio: { ...ready.portfolio, accountingDifference: 15 } } });
  await act(async () => { render(<AutopilotPortfolio />); });
  expect(screen.getByRole('alert')).toHaveTextContent('Écart comptable');
});
