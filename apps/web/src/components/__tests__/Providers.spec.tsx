import { render, screen } from '@testing-library/react';
import { Providers } from '../Providers';

jest.mock('../providers/TradingStoreProvider', () => ({
  TradingStoreProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="trading-store-provider">{children}</div>
  ),
}));

describe('Providers', () => {
  it('renders children wrapped by the error boundary, toast, query client and trading store providers', () => {
    render(
      <Providers>
        <div data-testid="app-content">Hello</div>
      </Providers>,
    );

    expect(screen.getByTestId('trading-store-provider')).toBeInTheDocument();
    expect(screen.getByTestId('app-content')).toHaveTextContent('Hello');
  });
});
