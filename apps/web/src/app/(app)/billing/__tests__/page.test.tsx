import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { createTestQueryClient } from '@/lib/test-utils';
import BillingPage from '../page';

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

describe('BillingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/billing/plans') {
        return Promise.resolve({
          data: [
            { id: 'p1', name: 'Basic', code: 'basic', price: 9, interval: 'MONTH', maxStrategies: 3, maxSignals: 50, maxPortfolios: 2, features: ['Signaux temps réel'] },
          ],
        });
      }
      if (url === '/billing/subscription') {
        return Promise.resolve({
          data: { id: 's1', status: 'ACTIVE', currentPeriodEnd: '2026-08-01T00:00:00Z', plan: { name: 'Basic', code: 'basic' } },
        });
      }
      if (url === '/billing/usage') {
        return Promise.resolve({
          data: {
            plan: { name: 'Basic', code: 'basic' },
            portfolios: { used: 1, limit: 2 },
            strategies: { used: 2, limit: 3 },
            signals: { used: 5, limit: 50 },
          },
        });
      }
      return Promise.resolve({ data: null });
    });
  });

  it('renders current plan and usage panel', async () => {
    render(
      <Wrapper>
        <BillingPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Plan actuel')).toBeInTheDocument();
    });
    expect(screen.getByText('Utilisation')).toBeInTheDocument();
    expect(screen.getByText('Portfolios')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Stratégies actives')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('Signaux / jour')).toBeInTheDocument();
    expect(screen.getByText('5 / 50')).toBeInTheDocument();
  });

  it('renders available plans', async () => {
    render(
      <Wrapper>
        <BillingPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Basic').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Plan actif')).toBeInTheDocument();
  });
});
