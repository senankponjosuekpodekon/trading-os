import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: () => '/hidden-gems',
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock next/link
jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  MockLink.displayName = 'MockLink';
  return MockLink;
});

// Mock auth store
jest.mock('@/store/auth.store', () => ({
  useAuthStore: () => ({ user: { id: '1', timezone: 'UTC' } }),
}));

// Mock mode store
jest.mock('@/store/mode.store', () => ({
  useModeStore: () => ({ mode: 'professional' }),
}));

// Mock AppLayout
jest.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode; title: string }) => <div data-testid="layout">{children}</div>,
}));

// Mock api
jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: { gems: [], summary: 'No gems found', projects: [] } }),
    post: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

describe('Phase Pages', () => {
  it('Hidden Gems — renders title', async () => {
    const { default: Page } = await import('@/app/hidden-gems/page');
    render(<Wrapper><Page /></Wrapper>);
    expect(screen.getByText('Hidden Gems')).toBeInTheDocument();
  });

  it('AI Defense — renders title', async () => {
    const { default: Page } = await import('@/app/ai-defense/page');
    render(<Wrapper><Page /></Wrapper>);
    expect(screen.getByText('AI Defense')).toBeInTheDocument();
  });

  it('Rebalancing — renders title', async () => {
    const { default: Page } = await import('@/app/rebalancing/page');
    render(<Wrapper><Page /></Wrapper>);
    expect(screen.getByText('Portfolio Rebalancing')).toBeInTheDocument();
  });

  it('Sentiment — renders title and tabs', async () => {
    const { default: Page } = await import('@/app/sentiment/page');
    render(<Wrapper><Page /></Wrapper>);
    expect(screen.getByText('Social Sentiment')).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
  });

  it('Pre-Listing — renders title', async () => {
    const { default: Page } = await import('@/app/pre-listing/page');
    render(<Wrapper><Page /></Wrapper>);
    expect(screen.getByText('Pre-Listing Alpha')).toBeInTheDocument();
  });

  it('Scientific Backtest — renders title and tabs', async () => {
    const { default: Page } = await import('@/app/scientific-backtest/page');
    render(<Wrapper><Page /></Wrapper>);
    expect(screen.getByText('Scientific Backtest')).toBeInTheDocument();
    expect(screen.getByText('Full Report')).toBeInTheDocument();
    expect(screen.getByText('Monte Carlo')).toBeInTheDocument();
    expect(screen.getByText('Walk-Forward')).toBeInTheDocument();
    expect(screen.getByText('Overfitting')).toBeInTheDocument();
  });
});
