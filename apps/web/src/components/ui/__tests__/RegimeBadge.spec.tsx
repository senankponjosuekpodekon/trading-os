import React from 'react';
import { render, screen } from '@testing-library/react';
import { RegimeBadge } from '../RegimeBadge';

describe('RegimeBadge', () => {
  it('renders nothing when regime is missing', () => {
    const { container } = render(<RegimeBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the regime label with correct styling', () => {
    render(<RegimeBadge regime="TRENDING_BULL" />);
    expect(screen.getByText('TRENDING BULL')).toBeInTheDocument();
  });

  it('falls back to low volatility style for unknown regime', () => {
    render(<RegimeBadge regime="WEIRD" />);
    expect(screen.getByText('WEIRD')).toBeInTheDocument();
  });
});
