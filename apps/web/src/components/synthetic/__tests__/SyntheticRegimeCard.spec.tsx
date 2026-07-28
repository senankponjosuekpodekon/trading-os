import React from 'react';
import { render, screen } from '@testing-library/react';
import { SyntheticRegimeCard, SyntheticAnalysis } from '../SyntheticRegimeCard';

function buildAnalysis(overrides: Partial<SyntheticAnalysis> = {}): SyntheticAnalysis {
  return {
    symbol: 'R_100',
    deriv_symbol: 'R_100',
    category: 'volatility',
    last_price: 1234.56,
    regime: 'LOW_VOL',
    state: 'range',
    spike_probability: 12,
    mean_reversion_prob: 45,
    atr_z: -0.5,
    bb_width_z: -1.2,
    expected_range: [1200, 1270],
    monte_carlo: { p10: 1190, p50: 1235, p90: 1280 },
    caution: false,
    source: 'live',
    ...overrides,
  };
}

const color = { border: 'border-blue-400/20', text: 'text-blue-400', bg: 'bg-blue-400/10' };

describe('SyntheticRegimeCard', () => {
  it('renders LOW_VOL regime with blue style', () => {
    render(<SyntheticRegimeCard analysis={buildAnalysis()} color={color} />);
    expect(screen.getByText('R_100')).toBeInTheDocument();
    expect(screen.getByText('LOW_VOL')).toBeInTheDocument();
    expect(screen.getByText(/234[.,]\s?56/)).toBeInTheDocument();
  });

  it('shows spike risk alert when caution is true', () => {
    render(<SyntheticRegimeCard analysis={buildAnalysis({ regime: 'SPIKE_RISK', state: 'spike', spike_probability: 78, caution: true })} color={color} />);
    expect(screen.getByTestId('caution-alert')).toBeInTheDocument();
    expect(screen.getByText(/Régime instable/i)).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
  });

  it('renders the spike probability gauge value', () => {
    render(<SyntheticRegimeCard analysis={buildAnalysis({ spike_probability: 0.78 * 100 })} color={color} />);
    expect(screen.getByText('78%')).toBeInTheDocument();
  });

  it('shows error when given a non-synthetic category', () => {
    render(<SyntheticRegimeCard analysis={buildAnalysis({ category: 'crypto' })} color={color} />);
    expect(screen.getByText('Marché non synthétique')).toBeInTheDocument();
  });
});
