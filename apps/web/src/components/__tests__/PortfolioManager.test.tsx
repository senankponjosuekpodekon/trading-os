import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortfolioManagerPage from '@/app/(app)/portfolio-manager/page';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

jest.mock('@/store/auth.store', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/components/AutopilotPortfolio', () => ({ AutopilotPortfolio: () => <div>System paper supervision</div> }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));

let role: string;
const portfolios = [
  { id: 'paper', name: 'Mon Portfolio', type: 'PAPER', currency: 'USD' },
  { id: 'live', name: 'Portefeuille réel', type: 'LIVE', currency: 'USD' },
];
beforeEach(() => {
  role = 'ADMIN';
  (useAuthStore as unknown as jest.Mock).mockImplementation(selector => selector({ user: { role } }));
  (api.get as jest.Mock).mockImplementation((url: string) => Promise.resolve({ data:
    url === '/portfolios' ? portfolios : url.endsWith('/state') ? {
      equity: 10000, cash: 10000, unrealized_pnl: null, n_positions: 0, clusters: {}, venues: {}, positions: [],
    } : url.includes('/snapshots') || url.endsWith('/ledger') ? [] : {},
  }));
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = render(<PortfolioManagerPage />, { wrapper });
  return { ...view, close: () => { view.unmount(); client.clear(); } };
}

it.each(['ADMIN', 'SUPER_ADMIN', 'TRADER', 'INVESTOR'])('defaults to the personal portfolio and limits the AutoPilot tab for %s', async userRole => {
  role = userRole;
  const view = setup();
  await screen.findByText('Mon Portfolio');
  expect(screen.queryByText('System paper supervision')).not.toBeInTheDocument();
  if (['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    expect(screen.getByRole('tab', { name: 'Mon portefeuille' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'AutoPilot système — Paper' }));
    expect(screen.getByText('System paper supervision')).toBeInTheDocument();
    expect(screen.queryByText('Mon Portfolio')).not.toBeInTheDocument();
    expect(screen.queryByText('Exécution')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Mon portefeuille' }));
    expect(await screen.findByText('Mon Portfolio')).toBeInTheDocument();
  } else {
    expect(screen.queryByRole('tab', { name: 'AutoPilot système — Paper' })).not.toBeInTheDocument();
  }
  view.close();
});

it('keeps the personal Demo/Real selection separate from the system paper tab', async () => {
  const view = setup();
  await screen.findByText('Mon Portfolio');
  fireEvent.click(screen.getByRole('button', { name: 'Réel' }));
  await screen.findByText('Portefeuille réel');
  fireEvent.click(screen.getByRole('tab', { name: 'AutoPilot système — Paper' }));
  expect(screen.queryByText('Portefeuille réel')).not.toBeInTheDocument();
  expect(screen.getByText('System paper supervision')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Mon portefeuille' }));
  expect(await screen.findByText('Portefeuille réel')).toBeInTheDocument();
  view.close();
});

it('removes system supervision when administrator access is lost', async () => {
  const view = setup();
  await screen.findByText('Mon Portfolio');
  fireEvent.click(screen.getByRole('tab', { name: 'AutoPilot système — Paper' }));
  role = 'TRADER';
  view.rerender(<PortfolioManagerPage />);
  expect(screen.queryByText('System paper supervision')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'AutoPilot système — Paper' })).not.toBeInTheDocument();
  expect(await screen.findByText('Mon Portfolio')).toBeInTheDocument();
  view.close();
});

it('opens system supervision without waiting for the personal portfolio request', () => {
  (api.get as jest.Mock).mockImplementation((url: string) => url === '/portfolios'
    ? new Promise(() => {}) : Promise.resolve({ data: {} }));
  const view = setup();
  fireEvent.click(screen.getByRole('tab', { name: 'AutoPilot système — Paper' }));
  expect(screen.getByText('System paper supervision')).toBeInTheDocument();
  expect(screen.queryByText('Mon Portfolio')).not.toBeInTheDocument();
  view.close();
});

it('supports keyboard navigation between the two tabs', async () => {
  const view = setup();
  await screen.findByText('Mon Portfolio');
  const personal = screen.getByRole('tab', { name: 'Mon portefeuille' });
  personal.focus();
  fireEvent.keyDown(personal, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'AutoPilot système — Paper' })).toHaveFocus();
  expect(screen.getByText('System paper supervision')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'AutoPilot système — Paper' }), { key: 'Home' });
  expect(personal).toHaveFocus();
  expect(screen.queryByText('System paper supervision')).not.toBeInTheDocument();
  view.close();
});
