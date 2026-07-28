import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';
import SettingsPage from '../page';
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
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
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

const mockStrategies = [
  { id: 's1', name: 'MA Cross', description: '', rules: {}, isActive: true, isEnabledByUser: true, createdAt: '2024-01-01T00:00:00Z', userStrategy: { isEnabled: true } },
  { id: 's2', name: 'Breakout', description: '', rules: {}, isActive: true, isEnabledByUser: false, createdAt: '2024-01-01T00:00:00Z', userStrategy: { isEnabled: false } },
];

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace: jest.fn() });
    (usePathname as unknown as jest.Mock).mockReturnValue('/settings');
    (useAuthStore as unknown as jest.Mock).mockReturnValue({
      user: { id: '1', name: 'Test User' },
      token: 'token',
      init: jest.fn(),
    });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead: jest.fn() });
  });

  it('optimistically toggles a strategy before server response', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockStrategies });
    (api.patch as jest.Mock).mockImplementation(() => new Promise(() => {})); // never resolves

    render(
      <Wrapper>
        <SettingsPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('MA Cross')).toBeInTheDocument());

    expect(screen.getByText('1 stratégie(s) activée(s)')).toBeInTheDocument();

    const toggleButtons = screen.getAllByRole('button', { name: /Désactiver|Activer/i });
    fireEvent.click(toggleButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('0 stratégie(s) activée(s)')).toBeInTheDocument();
    });

    expect(api.patch).toHaveBeenCalledWith('/strategies/s1/toggle', { isEnabled: false });
  });

  it('optimistically removes a strategy before server response', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockStrategies });
    (api.delete as jest.Mock).mockImplementation(() => new Promise(() => {}));
    window.confirm = jest.fn(() => true);

    render(
      <Wrapper>
        <SettingsPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('MA Cross')).toBeInTheDocument());

    const removeButtons = screen.getAllByRole('button', { name: /Supprimer/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('MA Cross')).not.toBeInTheDocument();
    });

    expect(api.delete).toHaveBeenCalledWith('/strategies/s1');
  });

  it('opens onboarding questionnaire and applies recommended profile', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockStrategies });

    render(
      <Wrapper>
        <SettingsPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('MA Cross')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Questionnaire/i }));

    await waitFor(() => {
      expect(screen.getByText(/Définir mon profil trader/i)).toBeInTheDocument();
    });

    // Conservative answers (all first choices)
    for (let i = 0; i < 4; i++) {
      await waitFor(() => {
        const choices = screen.getAllByRole('button');
        const firstChoice = choices.find(b =>
          b.textContent?.includes('Débutant') ||
          b.textContent?.includes('0.5 %') ||
          b.textContent?.includes('-5 %') ||
          b.textContent?.includes('Swing')
        );
        expect(firstChoice).toBeTruthy();
        fireEvent.click(firstChoice!);
      });
    }

    await waitFor(() => {
      expect(screen.getByText(/Profil recommandé/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Appliquer ce profil/i }));

    await waitFor(() => {
      expect(screen.getByTestId('current-profile')).toHaveTextContent('conservative');
    });

    expect(localStorage.getItem('trading_profile')).toBe('conservative');
  });

  it('allows skipping the onboarding questionnaire without changing profile', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockStrategies });

    render(
      <Wrapper>
        <SettingsPage />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText('MA Cross')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Questionnaire/i }));
    await waitFor(() => {
      expect(screen.getByText(/Définir mon profil trader/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('skip-onboarding'));

    await waitFor(() => {
      expect(screen.queryByText(/Définir mon profil trader/i)).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('current-profile')).toHaveTextContent('moderate');
    expect(localStorage.getItem('trading_profile')).toBeNull();
  });
});
