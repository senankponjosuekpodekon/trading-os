import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import PerformancePage from '../page';
import { createTestQueryClient } from '@/lib/test-utils';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/hooks/useNotifications', () => ({
  useNotifications: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="app-layout" data-title={title}>{children}</div>
  ),
}));

jest.mock('@/components/backtest/MiniEquityChart', () => ({
  MiniEquityChart: ({ curve }: { curve: number[] }) => (
    <div data-testid="mini-equity-chart" data-points={curve.length}>chart</div>
  ),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('PerformancePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/performance');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders performance metrics and equity chart', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'p1', name: 'Main', type: 'PAPER' }] })
      .mockResolvedValueOnce({
        data: {
          totalPnl: 1500,
          winRate: 60,
          positions: [
            { id: '1', status: 'CLOSED', direction: 'BUY', entryPrice: '100', exitPrice: '110', quantity: '1', asset: { symbol: 'A' }, pnl: '10', pnlPercent: '10', openedAt: '2024-01-01T00:00:00Z', closedAt: '2024-01-02T00:00:00Z' },
            { id: '2', status: 'CLOSED', direction: 'SELL', entryPrice: '200', exitPrice: '190', quantity: '1', asset: { symbol: 'B' }, pnl: '10', pnlPercent: '5', openedAt: '2024-01-03T00:00:00Z', closedAt: '2024-01-04T00:00:00Z' },
          ],
        },
      });

    render(
      <Wrapper>
        <PerformancePage />
      </Wrapper>,
    );

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/portfolios'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/positions/summary?portfolioId=ALL'));
    await waitFor(() => expect(screen.getByText(/Performance/i)).toBeInTheDocument());
    expect(screen.getAllByText(/Trades clôturés/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('mini-equity-chart')).toBeInTheDocument();
  });

  it('fetches and displays AI post-trade review for a closed position', async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: { review: 'SL bien placé sous FVG.' } });

    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'p1', name: 'Main', type: 'PAPER' }] })
      .mockResolvedValueOnce({
        data: {
          totalPnl: 10,
          winRate: 100,
          positions: [
            { id: 'pos-1', status: 'CLOSED', direction: 'BUY', entryPrice: '100', exitPrice: '110', quantity: '1', asset: { symbol: 'A' }, pnl: '10', pnlPercent: '10', openedAt: '2024-01-01T00:00:00Z', closedAt: '2024-01-02T00:00:00Z' },
          ],
        },
      });

    render(
      <Wrapper>
        <PerformancePage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Meilleur trade')).toBeInTheDocument();
    }, { timeout: 3000 });

    const reviewButtons = screen.getAllByRole('button', { name: /Review IA/i });
    fireEvent.click(reviewButtons[reviewButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('SL bien placé sous FVG.')).toBeInTheDocument();
    });

    expect(api.post).toHaveBeenCalledWith('/ai/review/position/pos-1', {});
  });
});
