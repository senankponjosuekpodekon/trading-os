import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import PatternsPage from '../page';
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

describe('PatternsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/patterns');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('renders pattern stats and post-trade analysis', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          total: 2,
          patterns: {
            double_top: { trades: 2, wins: 1, losses: 1, pnl: 5, winRate: 50, avgDuration: 4, avgConfluence: 0.75, avgRealizedPnl: 1.5, avgExpectedPnl: 2.0 },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          sampleSize: 2,
          avgExpectedPnlPct: 2.0,
          avgRealizedPnlPct: 1.5,
          bias: -0.25,
          overestimating: true,
          underestimating: false,
        },
      });

    render(
      <Wrapper>
        <PatternsPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('double_top')).toBeInTheDocument();
    });

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/surestime/)).toBeInTheDocument();
  });
});
