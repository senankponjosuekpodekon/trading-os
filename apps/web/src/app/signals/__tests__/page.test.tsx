import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import SignalsPage from '../page';
import { createTestQueryClient } from '@/lib/test-utils';
import { useTradingStore } from '@/store/trading.store';

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn() as jest.Mock,
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

const mockSignals = [
  {
    id: 's1',
    signal: 'BUY',
    confidence: 75,
    timeframe: '1h',
    entryPrice: '100',
    stopLoss: '95',
    takeProfit1: '110',
    riskReward: '2.0',
    asset: { symbol: 'BTC/USDT' },
    createdAt: new Date().toISOString(),
    metadata: {},
  },
];

describe('SignalsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTradingStore.setState({
      signals: [],
      signalsLoading: false,
      signalsError: null,
      signalsFetchedAt: null,
    });
  });

  it('renders empty state and scan button', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { data: [] } });

    render(
      <Wrapper>
        <SignalsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText(/aucun signal/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /scanner/i })).toBeInTheDocument();
  });

  it('renders list of signals', async () => {
    useTradingStore.setState({ signals: mockSignals as any, signalsFetchedAt: Date.now() });

    render(
      <Wrapper>
        <SignalsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
    });
    expect(screen.getByText(/BUY/)).toBeInTheDocument();
    expect(screen.getAllByText('1h').length).toBeGreaterThanOrEqual(1);
  });

  it('calls scan mutation when button clicked', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
    (api.post as jest.Mock).mockResolvedValue({ data: [] });

    render(
      <Wrapper>
        <SignalsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /scanner/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /scanner/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/signals/scan', expect.any(Object));
    });
  });
});
