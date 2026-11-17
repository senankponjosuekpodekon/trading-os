import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import SignalsPage from '../page';
import { SignalTrackingSheet } from '@/components/signals/SignalTrackingSheet';
import { createTestQueryClient } from '@/lib/test-utils';
import { useTradingStore } from '@/store/trading.store';
import { ToastProvider } from '@/components/ui/ToastProvider';

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
    <ToastProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        {children}
      </QueryClientProvider>
    </ToastProvider>
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
    takeProfit2: '120',
    takeProfit3: '130',
    riskReward: '2.0',
    asset: { symbol: 'BTC/USDT' },
    createdAt: new Date().toISOString(),
    metadata: {},
  },
];

describe('SignalTrackingSheet paper decisions', () => {
  const props = { signalId: 's1', symbol: 'SOL/USDT', signal: 'BUY', open: true, onClose: jest.fn() };
  const event = { id: 'e1', type: 'ENTRY_HIT', price: '73.71', sizePct: '100', candleTime: '2026-11-17T14:00:00Z', resolvedBy: 'CANDLE_CLOSE' };

  it('distinguishes theoretical tracking from confirmed paper execution', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/execution') ? [event] : { points: [] } }));
    render(<SignalTrackingSheet {...props} />);
    expect(await screen.findByText(/exécution paper non confirmée/)).toBeInTheDocument();
  });

  it('shows persisted AutoPilot refusal reasons', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/execution')
      ? [{ ...event, metadata: { autopilot: { reason: 'GATE_UNAVAILABLE', mode: 'PAPER' } } }] : { points: [] } }));
    render(<SignalTrackingSheet {...props} />);
    expect(await screen.findByText(/contrôle de risque indisponible/)).toBeInTheDocument();
  });

  it('clears stale errors when changing signal', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('unavailable'));
    const { rerender } = render(<SignalTrackingSheet {...props} />);
    expect(await screen.findByText('Impossible de charger le suivi')).toBeInTheDocument();
    (api.get as jest.Mock).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/execution') ? [event] : { points: [] } }));
    rerender(<SignalTrackingSheet {...props} signalId="s2" />);
    expect(await screen.findByText(/exécution paper non confirmée/)).toBeInTheDocument();
    expect(screen.queryByText('Impossible de charger le suivi')).not.toBeInTheDocument();
  });
});

describe('SignalsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
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
    expect(screen.getByRole('button', { name: /scanner.*actif/i })).toBeInTheDocument();
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

  it('displays TP1/TP2/TP3 probabilities for a signal', async () => {
    useTradingStore.setState({ signals: mockSignals as any, signalsFetchedAt: Date.now() });

    render(
      <Wrapper>
        <SignalsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
    });

    expect(screen.getAllByText('TP1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('TP2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('TP3').length).toBeGreaterThanOrEqual(1);
  });

  it('filters signals by trader profile', async () => {
    useTradingStore.setState({
      signals: [
        { ...mockSignals[0], id: 's1', asset: { symbol: 'BTC/USDT' }, profileSuitability: ['conservative', 'moderate'] },
        { ...mockSignals[0], id: 's2', asset: { symbol: 'ETH/USDT' }, profileSuitability: ['aggressive'] },
      ] as any,
      signalsFetchedAt: Date.now(),
    });

    render(
      <Wrapper>
        <SignalsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
    });
    expect(screen.getByText('ETH/USDT')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Agressif/i }));

    await waitFor(() => {
      expect(screen.queryByText('BTC/USDT')).not.toBeInTheDocument();
      expect(screen.getByText('ETH/USDT')).toBeInTheDocument();
    });
  });

  it('filters signals by market', async () => {
    useTradingStore.setState({
      signals: [
        { ...mockSignals[0], id: 's1', asset: { symbol: 'BTC/USDT' } },
        { ...mockSignals[0], id: 's2', asset: { symbol: 'EUR/USD' } },
      ] as any,
      signalsFetchedAt: Date.now(),
    });

    render(
      <Wrapper>
        <SignalsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
    });
    expect(screen.getByText('EUR/USD')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Forex/i })[0]);

    await waitFor(() => {
      expect(screen.queryByText('BTC/USDT')).not.toBeInTheDocument();
      expect(screen.getByText('EUR/USD')).toBeInTheDocument();
    });
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
      expect(screen.getByRole('button', { name: /scanner.*actif/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /scanner.*actif/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/signals/scan', expect.any(Object));
    });
  });
});
