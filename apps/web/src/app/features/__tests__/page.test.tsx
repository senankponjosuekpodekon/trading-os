import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import FeaturesPage from '../page';
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

describe('FeaturesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/features');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('renders feature weights and predict button', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: { trained: true, accuracy: 0.72, sampleCount: 450, featureCount: 9 } })
      .mockResolvedValueOnce({
        data: {
          trained: true,
          accuracy: 0.72,
          sampleCount: 450,
          featureWeights: { confidence: 0.9, scoreTotal: 0.7, riskReward: 0.6 },
        },
      });

    render(
      <Wrapper>
        <FeaturesPage />
      </Wrapper>,
    );

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/signals/predictor/status'));
    await waitFor(() => expect(screen.getByText('Feature Factory Inspector')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('confidence')).toBeInTheDocument());
  });
});
