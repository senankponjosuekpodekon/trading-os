import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortfolioManagerPage from '@/app/(app)/portfolio-manager/page';
import { useAuthStore } from '@/store/auth.store';

jest.mock('@/store/auth.store', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/components/AutopilotPortfolio', () => ({ AutopilotPortfolio: () => <div>System paper supervision</div> }));
jest.mock('@/lib/api', () => ({ api: { get: jest.fn().mockImplementation((url: string) => Promise.resolve({ data: url === '/portfolios' ? [] : {} })) } }));

it.each(['ADMIN', 'SUPER_ADMIN', 'TRADER', 'INVESTOR'])('limits system supervision visibility for %s', async role => {
  (useAuthStore as unknown as jest.Mock).mockImplementation(selector => selector({ user: { role } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><PortfolioManagerPage /></QueryClientProvider>);
  await screen.findByText('Gestion de portefeuille');
  if (['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    expect(screen.getByText('System paper supervision')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Réel'));
  }
  expect(screen.queryByText('System paper supervision')).not.toBeInTheDocument();
  view.unmount();
  client.clear();
});
