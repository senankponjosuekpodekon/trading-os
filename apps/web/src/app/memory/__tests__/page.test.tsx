import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import MemoryPage from '../page';
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
  api: { post: jest.fn() },
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

describe('MemoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/memory');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('renders and searches similar signals', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        neighbours: [
          {
            id: '1', symbol: 'BTC/USDT', timeframe: '1h', signalType: 'BUY', confidence: 72,
            scoreTotal: 65, regime: 'TRENDING_BULL', outcome: 'WIN_TP1', createdAt: '2026-07-01T12:00:00Z', similarity: 92,
          },
        ],
      },
    });

    render(
      <Wrapper>
        <MemoryPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('Market Memory')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Chercher les analogues/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/signals/memory/similar', expect.any(Object)));
    await waitFor(() => expect(screen.getByText('BTC/USDT')).toBeInTheDocument());
  });
});
