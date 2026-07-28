import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import OnChainPage from '../page';
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

describe('OnChainPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/onchain');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('renders btc and eth metrics', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: { price: 65000, marketCap: 1.2e12, transactions24h: 300000, mempoolSize: 120000, suggestedFee: 25 } })
      .mockResolvedValueOnce({ data: { price: 3500, marketCap: 4.2e11, transactions24h: 1200000, gasPriceMedian: 18 } });

    render(
      <Wrapper>
        <OnChainPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('On-chain Dashboard')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Bitcoin')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Ethereum')).toBeInTheDocument());
  });
});
