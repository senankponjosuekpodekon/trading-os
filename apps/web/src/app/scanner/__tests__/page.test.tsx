import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import ScannerPage from '../page';
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

jest.mock('@/hooks/useToast', () => ({
  useToast: jest.fn(() => ({ toast: jest.fn() })),
}));

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
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

describe('ScannerPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/scanner');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('renders signals and triggers a scan', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        data: [
          { id: '1', signal: 'BUY', confidence: 75, timeframe: '1h', asset: { symbol: 'BTC/USDT' }, entryPrice: '60000', stopLoss: '59000', takeProfit1: '63000', metadata: {} },
          { id: '2', signal: 'SELL', confidence: 60, timeframe: '4h', asset: { symbol: 'EUR/USD' }, entryPrice: '1.10', stopLoss: '1.11', takeProfit1: '1.08', metadata: {} },
        ],
      },
    });
    (api.post as jest.Mock).mockResolvedValue({ data: { saved: [{ id: '1' }] } });

    render(
      <Wrapper>
        <ScannerPage />
      </Wrapper>,
    );

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/signals?limit=50'));
    await waitFor(() => expect(screen.getByText('BTC/USDT')).toBeInTheDocument());

    const scanButton = screen.getByRole('button', { name: /Lancer un scan/i });
    await userEvent.click(scanButton);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/signals/scan', expect.any(Object)));
  });

  it('displays result counts', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        data: [
          { id: '1', signal: 'BUY', confidence: 75, timeframe: '1h', asset: { symbol: 'BTC/USDT' }, entryPrice: '60000', stopLoss: '59000', takeProfit1: '63000', metadata: {} },
          { id: '2', signal: 'SELL', confidence: 75, timeframe: '1h', asset: { symbol: 'ETH/USDT' }, entryPrice: '3000', stopLoss: '3100', takeProfit1: '2800', metadata: {} },
        ],
      },
    });

    render(
      <Wrapper>
        <ScannerPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
      expect(screen.getByText('ETH/USDT')).toBeInTheDocument();
    });
  });

  it('shows empty state when no signals match', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { data: [] } });

    render(
      <Wrapper>
        <ScannerPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Aucun signal ne correspond aux filtres')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Lancer un scan maintenant/i })).toBeInTheDocument();
    });
  });

  it('renders loading skeleton while fetching signals', async () => {
    (api.get as jest.Mock).mockImplementation(() => new Promise(() => {}));

    render(
      <Wrapper>
        <ScannerPage />
      </Wrapper>,
    );

    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('sorts signals by opportunity score descending', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        data: [
          { id: '1', signal: 'BUY', confidence: 60, timeframe: '1h', asset: { symbol: 'ETH/USDT' }, entryPrice: '3000', stopLoss: '2950', takeProfit1: '3100', metadata: {} },
          { id: '2', signal: 'BUY', confidence: 90, timeframe: '1h', asset: { symbol: 'BTC/USDT' }, entryPrice: '60000', stopLoss: '59000', takeProfit1: '63000', metadata: {} },
        ],
      },
    });

    const { container } = render(
      <Wrapper>
        <ScannerPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
    });

    const btcIndex = container.textContent?.indexOf('BTC/USDT') ?? -1;
    const ethIndex = container.textContent?.indexOf('ETH/USDT') ?? -1;
    expect(btcIndex).toBeLessThan(ethIndex);
  });

  it('filters signals by direction', async () => {
    const user = userEvent.setup();
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        data: [
          { id: '1', signal: 'BUY', confidence: 75, timeframe: '1h', asset: { symbol: 'BTC/USDT' }, entryPrice: '60000', stopLoss: '59000', takeProfit1: '63000', metadata: {} },
          { id: '2', signal: 'SELL', confidence: 75, timeframe: '1h', asset: { symbol: 'ETH/USDT' }, entryPrice: '3000', stopLoss: '3100', takeProfit1: '2800', metadata: {} },
        ],
      },
    });

    render(
      <Wrapper>
        <ScannerPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('BTC/USDT')).toBeInTheDocument());
    expect(screen.getByText('ETH/USDT')).toBeInTheDocument();

    const directionSelect = screen.getByRole('combobox', { name: /Direction/i });
    await user.selectOptions(directionSelect, 'SELL');

    const updatedSelect = screen.getByRole('combobox', { name: /Direction/i }) as HTMLSelectElement;
    expect(updatedSelect.value).toBe('SELL');

    await waitFor(() => {
      expect(screen.getByText(/1 résultat/i)).toBeInTheDocument();
    });
    // BTC/USDT option remains in the asset filter, only the signal card should disappear
    expect(screen.queryAllByText('BTC/USDT').length).toBe(1);
    expect(screen.queryAllByText('ETH/USDT').length).toBeGreaterThanOrEqual(1);
  });
});
