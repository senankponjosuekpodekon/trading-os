import { render, screen, fireEvent } from '@testing-library/react';
import { useAuthStore } from '@/store/auth.store';
import { useLivePrices } from '@/hooks/useLivePrices';
import { useNotifications } from '@/hooks/useNotifications';
import { Topbar } from '../Topbar';

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/hooks/useLivePrices', () => ({
  useLivePrices: jest.fn(),
}));

jest.mock('@/hooks/useNotifications', () => ({
  useNotifications: jest.fn(),
}));

jest.mock('../ModeToggle', () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

describe('Topbar', () => {
  const markAllRead = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: any) =>
      selector({ user: { name: 'Ada Lovelace', role: 'ADMIN' } }),
    );
    (useLivePrices as unknown as jest.Mock).mockReturnValue({ prices: { BTCUSDT: 65000, ETHUSDT: 3000 }, connected: true });
    (useNotifications as unknown as jest.Mock).mockReturnValue({ notifications: [], unread: 0, markAllRead });
  });

  it('renders the page title and the authenticated user', () => {
    render(<Topbar title="Dashboard" />);

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
  });

  it('shows live BTC/ETH prices and the LIVE badge when connected', () => {
    render(<Topbar title="Dashboard" />);

    expect(screen.getByText('$65,000.00')).toBeInTheDocument();
    expect(screen.getByText('$3,000.00')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('shows the OFF badge and a placeholder price when disconnected', () => {
    (useLivePrices as unknown as jest.Mock).mockReturnValue({ prices: {}, connected: false });
    render(<Topbar title="Dashboard" />);

    expect(screen.getByText('OFF')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the unread badge (capped at "9+") and clears it when the bell is opened', () => {
    (useNotifications as unknown as jest.Mock).mockReturnValue({
      notifications: [{ id: '1', type: 'SIGNAL', title: 'T', message: 'M', createdAt: new Date().toISOString(), read: false }],
      unread: 12,
      markAllRead,
    });
    render(<Topbar title="Dashboard" />);

    expect(screen.getByText('9+')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  it('toggles the notifications dropdown open and closed', () => {
    (useNotifications as unknown as jest.Mock).mockReturnValue({
      notifications: [{ id: '1', type: 'ALERT', title: 'Alerte prix', message: 'BTC a franchi 65k', createdAt: new Date().toISOString(), read: true }],
      unread: 0,
      markAllRead,
    });
    render(<Topbar title="Dashboard" />);

    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Alerte prix')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no notifications', () => {
    render(<Topbar title="Dashboard" />);

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('Aucune notification')).toBeInTheDocument();
  });

  it('renders expected-move / ML metadata badges for SIGNAL notifications', () => {
    (useNotifications as unknown as jest.Mock).mockReturnValue({
      notifications: [{
        id: '1',
        type: 'SIGNAL',
        title: 'Nouveau signal',
        message: 'BUY BTC/USDT',
        createdAt: new Date().toISOString(),
        read: false,
        data: { expectedMove: { move_pct: 2.5, horizon: 4, volatility_regime: 'high' }, mlConfidence: 87.3, mlRegime: 'trend' },
      }],
      unread: 1,
      markAllRead,
    });
    render(<Topbar title="Dashboard" />);

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(screen.getByText('±2.50%')).toBeInTheDocument();
    expect(screen.getByText('high vol')).toBeInTheDocument();
    expect(screen.getByText('ML 87.3%')).toBeInTheDocument();
    expect(screen.getByText('Regime trend')).toBeInTheDocument();
  });

  it('falls back to "..." when there is no authenticated user', () => {
    (useAuthStore as unknown as jest.Mock).mockImplementation((selector: any) => selector({ user: null }));
    render(<Topbar title="Dashboard" />);

    expect(screen.getByText('...')).toBeInTheDocument();
  });
});
