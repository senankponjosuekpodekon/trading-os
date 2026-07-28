import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import EconomicCalendarPage from '../page';
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

describe('EconomicCalendarPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/economic-calendar');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  const mockEvents = [
    { date: '2026-07-20', time: '08:30', currency: 'USD', impact: 'High', title: 'NFP', forecast: '200K', previous: '190K', category: 'NFP' },
    { date: '2026-07-22', time: '14:00', currency: 'USD', impact: 'Medium', title: 'FOMC Minutes', forecast: '—', previous: '—', category: 'FOMC' },
    { date: '2026-07-23', time: '08:30', currency: 'USD', impact: 'High', title: 'CPI m/m', forecast: '0.2%', previous: '0.3%', category: 'CPI' },
  ];

  it('renders events and category badges', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockEvents });
    render(
      <Wrapper>
        <EconomicCalendarPage />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('Calendrier économique')).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.getAllByText('NFP').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('FOMC').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('CPI').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('filters events by category', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockEvents });
    render(
      <Wrapper>
        <EconomicCalendarPage />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getAllByText('NFP')[0]).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'FOMC' } });

    await waitFor(() => {
      expect(screen.getByText('FOMC Minutes')).toBeInTheDocument();
      expect(screen.queryByText('CPI m/m')).not.toBeInTheDocument();
    });
  });
});
