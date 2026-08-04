import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { useToast } from '@/hooks/useToast';
import { api } from '@/lib/api';
import { AppLayout } from '../AppLayout';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/hooks/useNotifications', () => ({
  useNotifications: jest.fn(),
}));

jest.mock('@/hooks/useToast', () => ({
  useToast: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn() },
}));

jest.mock('../Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
jest.mock('../Topbar', () => ({ Topbar: ({ title }: { title: string }) => <div data-testid="topbar">{title}</div> }));
jest.mock('../BottomNav', () => ({ BottomNav: () => <div data-testid="bottom-nav" /> }));

describe('AppLayout', () => {
  const replace = jest.fn();
  const init = jest.fn();
  const toast = jest.fn();

  const renderLayout = (children: React.ReactNode = <div data-testid="children">hi</div>) => {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <AppLayout title="Dashboard">{children}</AppLayout>
      </QueryClientProvider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as unknown as jest.Mock).mockReturnValue({ replace });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [] });
    (useToast as unknown as jest.Mock).mockReturnValue({ toast });
    (api.get as jest.Mock).mockResolvedValue({ data: { data: [] } });
  });

  it('shows a loading spinner while auth is not ready / no user yet', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: null, init });

    renderLayout();

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('children')).not.toBeInTheDocument();
  });

  it('calls init exactly once on mount', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: null, init });

    renderLayout();

    expect(init).toHaveBeenCalledTimes(1);
  });

  it('redirects to /auth/login when ready but no token is stored', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: null, init });

    renderLayout();

    expect(replace).toHaveBeenCalledWith('/auth/login');
  });

  it('does not redirect when a user is stored, even without a user object yet', () => {
    localStorage.setItem('trading_os_user', JSON.stringify({ id: '1' }));
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: null, init });

    renderLayout();

    expect(replace).not.toHaveBeenCalled();
  });

  it('renders the full layout (sidebar/topbar/bottom nav/children) once a user is present', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: '1', name: 'Ada' }, init });

    renderLayout();

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toHaveTextContent('Dashboard');
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });

  it('prefetches portfolios and signals once a user is present', async () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: '1', name: 'Ada' }, init });

    await act(async () => {
      renderLayout();
    });

    expect(api.get).toHaveBeenCalledWith('/portfolios', expect.objectContaining({ signal: expect.anything() }));
    expect(api.get).toHaveBeenCalledWith('/signals?limit=5', expect.objectContaining({ signal: expect.anything() }));
  });

  it('shows a toast for the newest notification exactly once', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: '1', name: 'Ada' }, init });
    (useNotifications as unknown as jest.Mock).mockReturnValue({
      notifications: [{ id: 'n1', type: 'SYSTEM', title: 'Système', message: 'Maintenance prévue', createdAt: new Date().toISOString(), read: false }],
    });

    const { rerender } = renderLayout();

    expect(toast).toHaveBeenCalledWith('Maintenance prévue', expect.objectContaining({ title: 'Système', type: 'info' }));

    const callsAfterFirst = toast.mock.calls.length;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AppLayout title="Dashboard"><div /></AppLayout>
      </QueryClientProvider>,
    );
    expect(toast.mock.calls.length).toBe(callsAfterFirst);
  });

  it('enriches a SIGNAL notification toast with expected-move / ML metadata', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue({ user: { id: '1', name: 'Ada' }, init });
    (useNotifications as unknown as jest.Mock).mockReturnValue({
      notifications: [{
        id: 'n2',
        type: 'SIGNAL',
        title: 'Signal BTC',
        message: 'BUY BTC/USDT',
        createdAt: new Date().toISOString(),
        read: false,
        data: { expectedMove: { move_pct: 3.1, horizon: 6, volatility_regime: 'low' }, mlConfidence: 91.2, mlRegime: 'range' },
      }],
    });

    renderLayout();

    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('BUY BTC/USDT'),
      expect.objectContaining({ title: 'Signal BTC', type: 'success' }),
    );
    const [message] = toast.mock.calls[0];
    expect(message).toContain('±3.10%');
    expect(message).toContain('ML confidence 91.2%');
    expect(message).toContain('ML regime range');
  });
});
