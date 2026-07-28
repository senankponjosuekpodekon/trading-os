import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import RiskPage from '../page';
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
  api: { get: jest.fn() },
}));

jest.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="app-layout" data-title={title}>{children}</div>
  ),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('RiskPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/risk');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('renders risk dashboard with exposure and open positions', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({
        data: [{ id: 'p1', name: 'Main', type: 'PAPER', currentCapital: '10000', initialCapital: '10000' }],
      })
      .mockResolvedValueOnce({
        data: {
          totalPnl: 200,
          winRate: 55,
          positions: [
            { id: '1', status: 'OPEN', direction: 'BUY', entryPrice: '100', quantity: '2', asset: { symbol: 'AAPL/USD' }, stopLoss: '95' },
          ],
        },
      });

    render(
      <Wrapper>
        <RiskPage />
      </Wrapper>,
    );

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/portfolios'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/positions/summary?portfolioId=ALL'));
    await waitFor(() => expect(screen.getByText(/Risk Dashboard/i)).toBeInTheDocument());
    expect(screen.getAllByText(/Positions ouvertes/i).length).toBeGreaterThanOrEqual(1);
  });
});
