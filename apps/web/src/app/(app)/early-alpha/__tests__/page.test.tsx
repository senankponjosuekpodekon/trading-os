import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import EarlyAlphaPage from '../page';
import { createTestQueryClient } from '@/lib/test-utils';

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

const mockPresales = {
  data: [
      { id: 'p1', name: 'Nexum', symbol: 'NXM', chain: 'ETH', stage: 'private', listingType: 'IDO', platform: 'DAO Maker', raiseUsd: 1200000, goalUsd: 1800000, fundingPct: 67, price: 0.12, asymmetricScore: 62, riskScore: 38, riskFlags: ['Low funding'], opportunityFlags: [], githubCommits30d: 42, tvlMillions: 0, socialBuzz: 120, source: 'cryptorank', url: '', tags: ['IDO'] },
      { id: 'p2', name: 'Aurora', symbol: 'AURA', chain: 'SOL', stage: 'public', listingType: 'IEO', platform: '', raiseUsd: 800000, goalUsd: 950000, fundingPct: 84, price: 0.05, asymmetricScore: 48, riskScore: 52, riskFlags: [], opportunityFlags: [], githubCommits30d: 0, tvlMillions: 0, socialBuzz: 65, source: 'cryptorank', url: '', tags: ['IEO'] },
    ],
  summary: '2 pre-listing opportunities',
};

const mockOnchain = {
  data: [
      { assetSymbol: 'NXM', chain: 'ethereum', overallSignal: 'MILD_BULLISH', whaleConcentration: 34.5, holderGrowth24h: 12, developerActivity: 42, socialMentionVelocity: 120, asymmetricScore: 68, signalCount: 1, topSignals: [{ type: 'whale_accumulation', severity: 'high', direction: 'bullish', message: 'Whale accumulation detected' }] },
  ],
};

describe('EarlyAlphaPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/early-alpha/presales')) return { data: mockPresales };
      if (url.includes('/early-alpha/onchain')) return { data: mockOnchain };
      return { data: { data: [] } };
    });
  });

  it('renders presale and on-chain sections', async () => {
    render(
      <Wrapper>
        <EarlyAlphaPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Nexum')).toBeInTheDocument();
      expect(screen.getByText('Aurora')).toBeInTheDocument();
      expect(screen.getAllByText('NXM').length).toBeGreaterThan(0);
    });
  });

  it('filters presales by chain', async () => {
    render(
      <Wrapper>
        <EarlyAlphaPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('Nexum')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ETHEREUM' } });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/early-alpha/presales?chain=ETHEREUM'));
    });
  });

  it('shows high asymmetry warning for score >= 70', async () => {
    (api.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/early-alpha/presales')) return { data: mockPresales };
      if (url.includes('/early-alpha/onchain')) {
        return {
          data: {
            data: [
              { assetSymbol: 'PULSE', chain: 'ethereum', overallSignal: 'STRONG_BULLISH', whaleConcentration: 58.2, holderGrowth24h: 340, developerActivity: 8, socialMentionVelocity: 340, asymmetricScore: 88, signalCount: 3, topSignals: [] },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });

    render(
      <Wrapper>
        <EarlyAlphaPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('PULSE')).toBeInTheDocument();
      expect(screen.getByText(/Signal d’asymétrie élevé/i)).toBeInTheDocument();
    });
  });
});
