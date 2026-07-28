import React from 'react';
import { render, screen } from '@testing-library/react';
import { AssetTypeBadge } from '../AssetTypeBadge';

describe('AssetTypeBadge', () => {
  it('renders nothing when type is missing', () => {
    const { container } = render(<AssetTypeBadge type={''} />);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    ['CRYPTO', 'CRYPTO'],
    ['FOREX', 'FOREX'],
    ['SYNTHETIC', 'SYNTHETIC'],
    ['BRVM', 'BRVM'],
    ['COMMODITY', 'COMMODITY'],
  ])('renders %s badge', (type, expected) => {
    render(<AssetTypeBadge type={type} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
