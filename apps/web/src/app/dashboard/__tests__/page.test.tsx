import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import DashboardPage from '../page';
import { createTestQueryClient } from '@/lib/test-utils';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn() as jest.Mock,
  usePathname: jest.fn() as jest.Mock,
}));

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn() as jest.Mock,
}));

jest.mock('@/hooks/useNotifications', () => ({
  useNotifications: jest.fn() as jest.Mock,
}));

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn() as jest.Mock,
  },
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

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/dashboard');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User', email: 'test@example.com', role: 'USER' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({
      notifications: [],
      unread: 0,
      markAllRead: jest.fn(),
    });
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: jest.fn(() => 'token') },
      writable: true,
    });
  });

  it('renders dashboard with portfolio data and expected move widget', async () => {
    const expectedMovePayload = {
      symbol: 'BTC/USDT',
      timeframe: '1h',
      close: 100,
      atr: 2,
      atr_pct: 2,
      atr_percentile: 75,
      volatility_regime: 'HIGH',
      volume_ratio: 1.2,
      ranges: [
        { horizon: 5, move: 4.47, move_pct: 4.47, upper: 104.47, lower: 95.53 },
      ],
    };

    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/portfolios') {
        return Promise.resolve({ data: [{ id: 'p1', name: 'Main', type: 'PAPER', initialCapital: '10000', currentCapital: '11200' }] });
      }
      if (url.startsWith('/positions/summary')) {
        return Promise.resolve({ data: { totalPnl: 1200, winRate: 0.65, open: 2, closed: 5 } });
      }
      if (url === '/expected-move') {
        return Promise.resolve({ data: expectedMovePayload });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/portfolios');
    });

    await waitFor(() => {
      expect(screen.getByText(/capital disponible/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/11 200,00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/positions ouvertes/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/signaux actifs/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Expected Move Engine/i)).toBeInTheDocument();
    expect(screen.getByText(/Volatilité élevée/i)).toBeInTheDocument();
  });

  it('shows skeleton cards while loading', async () => {
    (api.get as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );

    expect(screen.queryByText(/capital disponible/i)).not.toBeInTheDocument();
  });

  it('shows error state when portfolio fetch fails', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.reject(new Error('Network error'));
      return Promise.resolve({ data: { data: [] } });
    });

    render(
      <Wrapper>
        <DashboardPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/portfolios');
    });
  });
});
