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
    { id: 'p1', name: 'Nexum', symbol: 'NXM', chain: 'ETH', stage: 'private', raiseUsd: 1200000, fdvUsd: 18000000, price: 0.12, vesting: '10% TGE', riskScore: 62, tags: ['DePIN'] },
    { id: 'p2', name: 'Aurora', symbol: 'AURA', chain: 'SOL', stage: 'public', raiseUsd: 800000, fdvUsd: 9500000, price: 0.05, vesting: '15% TGE', riskScore: 48, tags: ['DAO'] },
  ],
};

const mockOnchain = {
  data: [
    { assetSymbol: 'NXM/USDT', whaleConcentration: 34.5, exchangeInflow24h: 120000, exchangeOutflow24h: 85000, netFlow24h: 35000, developerActivity: 42, ageDays: 180, socialMentionVelocity: 120, asymmetricScore: 68 },
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
      expect(screen.getByText('NXM/USDT')).toBeInTheDocument();
    });
  });

  it('filters presales by chain', async () => {
    render(
      <Wrapper>
        <EarlyAlphaPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('Nexum')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ETH' } });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/early-alpha/presales?chain=ETH'));
    });
  });

  it('shows high asymmetry warning for score >= 70', async () => {
    (api.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/early-alpha/presales')) return { data: mockPresales };
      if (url.includes('/early-alpha/onchain')) {
        return {
          data: {
            data: [
              { assetSymbol: 'PULSE/USDT', whaleConcentration: 58.2, exchangeInflow24h: 250000, exchangeOutflow24h: 40000, netFlow24h: 210000, developerActivity: 8, ageDays: 60, socialMentionVelocity: 340, asymmetricScore: 88 },
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
      expect(screen.getByText('PULSE/USDT')).toBeInTheDocument();
      expect(screen.getByText(/Signal d’asymétrie élevé/i)).toBeInTheDocument();
    });
  });
});
