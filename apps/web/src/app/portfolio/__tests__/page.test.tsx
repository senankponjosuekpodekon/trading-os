import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@/lib/api';
import PortfolioPage from '../page';
import { createTestQueryClient } from '@/lib/test-utils';

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn() as jest.Mock,
    post: jest.fn() as jest.Mock,
    patch: jest.fn() as jest.Mock,
  },
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn() as jest.Mock,
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

const mockPortfolio = { id: 'p1', name: 'Main', type: 'PAPER', initialCapital: '10000', currentCapital: '11200' };
const mockPosition = {
  id: 'pos1',
  asset: { symbol: 'BTC/USDT' },
  direction: 'BUY',
  entryPrice: '100',
  quantity: '1',
  stopLoss: '95',
  takeProfit1: '110',
  takeProfit: '110',
  status: 'OPEN',
  openedAt: new Date().toISOString(),
  livePrice: 105,
  unrealizedPnl: 5,
  unrealizedPct: 5,
};

describe('PortfolioPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders portfolio page and fetches required data', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ data: [mockPortfolio] });
      if (url === '/signals?limit=10') return Promise.resolve({ data: { data: [] } });
      if (url.startsWith('/positions/summary')) return Promise.resolve({ data: { totalPnl: 1200, winRate: 0.65, open: 1, closed: 2 } });
      if (url === '/positions/live') return Promise.resolve({ data: [mockPosition] });
      return Promise.resolve({ data: [] });
    });

    render(
      <Wrapper>
        <PortfolioPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ouvertes/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /historique/i })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/portfolios');
      expect(api.get).toHaveBeenCalledWith('/positions/live');
    });
  });

  it('switches to history tab', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/portfolios') return Promise.resolve({ data: [mockPortfolio] });
      if (url === '/signals?limit=10') return Promise.resolve({ data: { data: [] } });
      if (url.startsWith('/positions/summary')) return Promise.resolve({ data: { totalPnl: 0, winRate: 0, open: 0, closed: 1 } });
      if (url === '/positions/live') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(
      <Wrapper>
        <PortfolioPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /historique/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /historique/i }));

    expect(screen.getByRole('button', { name: /historique/i })).toHaveClass('bg-emerald-500/20');
  });
});
