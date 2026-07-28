import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import axios from 'axios';
import SyntheticPage from '../page';
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

jest.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="app-layout" data-title={title}>{children}</div>
  ),
}));

jest.mock('axios');

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe('SyntheticPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/synthetic');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('renders synthetic indices cards', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        symbol: 'R_10',
        category: 'volatility',
        last_price: 1234.5,
        regime: 'LOW_VOLATILITY',
        state: 'RANGE',
        spike_probability: 20,
        mean_reversion_prob: 40,
        atr_z: 0.5,
        bb_width_z: -0.3,
        expected_range: [1200, 1250],
        monte_carlo: { p10: 1210, p50: 1235, p90: 1260 },
        caution: false,
        source: 'live',
      },
    });

    render(
      <Wrapper>
        <SyntheticPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText(/Synthetic Markets/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('R_10')).toBeInTheDocument());
  });
});
