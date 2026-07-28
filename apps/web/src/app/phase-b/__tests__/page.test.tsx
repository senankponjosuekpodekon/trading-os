import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { createTestQueryClient } from '@/lib/test-utils';
import PhaseBPage from '../page';

jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn() as jest.Mock,
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

describe('PhaseBPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/phase-b/tokenomics') return Promise.resolve({ data: { data: [{ assetSymbol: 'ETH', marketCap: 250000000000, supply: 120000000, holders: 1000000, volume24h: 15000000000 }] } });
      if (url === '/phase-b/social') return Promise.resolve({ data: { data: [{ source: 'X', symbol: 'BTC', sentimentScore: 0.42, mentionCount: 1200, trending: true }] } });
      if (url === '/phase-b/brvm') return Promise.resolve({ data: { data: [{ symbol: 'SNTS', name: 'Sonatel', sector: 'Telecom', price: 8000, changePct: 1.25 }] } });
      if (url === '/phase-b/synthetic') return Promise.resolve({ data: { data: [{ name: 'sBTC', underlying: 'BTC', price: 65000, volatility: 0.35 }] } });
      if (url === '/phase-b/ml-feedback/leaderboard') return Promise.resolve({ data: { data: [{ userId: 'u1', feedbackCount: 12, averageGrade: 4.2 }] } });
      return Promise.resolve({ data: { data: [] } });
    });
  });

  it('renders phase B page title and widgets', async () => {
    render(
      <Wrapper>
        <PhaseBPage />
      </Wrapper>,
    );

    expect(screen.getByText('Phase B - Données avancées')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Tokenomics')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('ETH')).toBeInTheDocument();
      expect(screen.getByText('Social Sentiment')).toBeInTheDocument();
      expect(screen.getByText('BRVM')).toBeInTheDocument();
      expect(screen.getByText('Synthétiques')).toBeInTheDocument();
      expect(screen.getByText('ML Feedback Leaderboard')).toBeInTheDocument();
    });
  });
});
