import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { RegimeBadge } from '../RegimeBadge';
import { AssetTypeBadge } from '../AssetTypeBadge';
import { ProbabilityBar } from '../ProbabilityBar';
import { OpportunityScore } from '../OpportunityScore';
import { ConfidenceGauge } from '../ConfidenceGauge';
import { RRRatioBadge } from '../RRRatioBadge';
import { TimeAgo } from '../TimeAgo';
import { LiveDot } from '../LiveDot';
import { ModeToggle } from '../../layout/ModeToggle';
import userEvent from '@testing-library/user-event';

describe('UI components', () => {
  it('renders RegimeBadge', () => {
    render(<RegimeBadge regime="TRENDING_BULL" />);
    expect(screen.getByText('TRENDING BULL')).toBeInTheDocument();
  });

  it('renders AssetTypeBadge', () => {
    render(<AssetTypeBadge type="CRYPTO" />);
    expect(screen.getByText('CRYPTO')).toBeInTheDocument();
  });

  it('renders ProbabilityBar with percentage', () => {
    render(<ProbabilityBar value={75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders OpportunityScore', () => {
    render(<OpportunityScore score={65} />);
    expect(screen.getByText('65')).toBeInTheDocument();
  });

  it('renders ConfidenceGauge', () => {
    render(<ConfidenceGauge value={80} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders RRRatioBadge', () => {
    render(<RRRatioBadge riskReward={2.5} />);
    expect(screen.getByText('R/R 1:2.5')).toBeInTheDocument();
  });

  it('renders TimeAgo', async () => {
    const date = new Date(Date.now() - 120_000).toISOString();
    render(<TimeAgo date={date} />);
    await waitFor(() => expect(screen.getByText(/il y a 2min/i)).toBeInTheDocument());
  });

  it('renders LiveDot live', () => {
    render(<LiveDot />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders LiveDot offline', () => {
    render(<LiveDot live={false} />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('toggles ModeToggle', async () => {
    render(<ModeToggle />);
    const beginner = screen.getByText('Débutant');
    const pro = screen.getByText('Pro');
    expect(pro).toHaveClass('text-emerald-400');
    await userEvent.click(beginner.parentElement as HTMLElement);
    expect(beginner).toHaveClass('text-emerald-400');
  });
});
