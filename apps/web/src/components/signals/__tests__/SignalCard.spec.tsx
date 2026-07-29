import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignalCard, SignalCardProps } from '../SignalCard';
import { useModeStore } from '@/store/mode.store';

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  MockLink.displayName = 'MockLink';
  return MockLink;
});

function buildSignal(): SignalCardProps['signal'] {
  return {
    id: 's1',
    assetId: 'a1',
    strategyId: 'strat1',
    signal: 'BUY',
    confidence: 78,
    timeframe: '1h',
    entryPrice: '50000',
    stopLoss: '49000',
    takeProfit1: '51000',
    takeProfit2: '52000',
    takeProfit3: '53000',
    riskReward: '2.0',
    profileSuitability: ['conservative', 'moderate'],
    explanation: 'Break of structure haussier avec order block et FVG.',
    createdAt: '2026-07-16T10:00:00Z',
    asset: { symbol: 'BTC/USDT' },
    metadata: {
      price_action: { trend: 'BULLISH', structure: 'TRENDING', bos: true, bos_dir: 'UP', choch: false },
      sr_zones: {},
      patterns: { pin_bar: 'bullish', engulfing: false },
      regime: { regime: 'TRENDING_BULL', adx: 32 },
      smc: {
        fvg: { near_bullish_fvg: { bottom: 49950, top: 50020 } },
        ob: { near_bullish_ob: { bottom: 49900, top: 49980, displacement_ratio: 0.6 } },
        liquidity: {},
      },
      mtf_context: { confluence: 'FULL', mtf_aligned: true, htf_aligned: true },
      detectedPatterns: [
        {
          name: 'abcd',
          direction: 'BUY',
          confidence: 0.82,
          confluenceScore: 0.8,
          prz: { min: 49800, max: 50100 },
          entry: 50000,
          stopLoss: 49000,
          targets: [51000, 52000],
          confluenceTags: ['fvg', 'ob'],
          reason: 'ABCD bullish sur FVG+OB',
        },
      ],
      decisionTrace: {
        why: [{ label: 'BOS UP confirmé', score: 10 }, { label: 'Confluence FULL', score: 5 }],
        whyNot: [{ label: 'ADX faible', score: 3 }],
      },
      news_sentiment: { label: 'bullish', bonus: 2, articles: [{ title: 'BTC up', url: 'http://x' }] },
    },
  } as any;
}

function renderCard(props: Partial<SignalCardProps> = {}) {
  const signal = buildSignal();
  const onExplain = jest.fn();
  return {
    ...render(
      <SignalCard
        signal={signal}
        prices={{ BTCUSDT: 50200 }}
        onExplain={onExplain}
        {...props}
      />,
    ),
    onExplain,
  };
}

describe('SignalCard', () => {
  beforeEach(() => {
    useModeStore.setState({ mode: 'professional' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders signal header with symbol, timeframe and badge', () => {
    renderCard();
    expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText(/BUY/)).toBeInTheDocument();
  });

  it('displays entry, stop loss and TP levels', () => {
    renderCard();
    expect(screen.getAllByText('$50000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$49000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$51000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2.0x')).toBeInTheDocument();
  });

  it('renders TP probability bars for TP1/TP2/TP3', () => {
    renderCard();
    expect(screen.getAllByText('TP1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('TP2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('TP3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/%/).length).toBeGreaterThanOrEqual(3);
  });

  it('shows detected pattern badge and expands details', () => {
    renderCard();
    expect(screen.getByText(/abcd/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Patterns détectés/));
    expect(screen.getByText('ABCD bullish sur FVG+OB')).toBeInTheDocument();
    expect(screen.getByText('fvg')).toBeInTheDocument();
    expect(screen.getByText('ob')).toBeInTheDocument();
  });

  it('expands why points', () => {
    renderCard();
    fireEvent.click(screen.getByText(/Pourquoi ce trade/));
    expect(screen.getByText('BOS UP confirmé')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
  });

  it('expands why not points', () => {
    renderCard();
    fireEvent.click(screen.getByText(/Pourquoi PAS/));
    expect(screen.getByText('ADX faible')).toBeInTheDocument();
  });

  it('calls onExplain when AI explain button clicked', () => {
    const { onExplain } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Expliquer avec l'IA/ }));
    expect(onExplain).toHaveBeenCalledWith('s1');
  });

  it('shows beginner summary in beginner mode', () => {
    useModeStore.setState({ mode: 'beginner' });
    const { container } = renderCard();
    expect(container.textContent).toContain('ACHAT BTC/USDT');
    expect(screen.queryByText(/Pourquoi ce trade/)).not.toBeInTheDocument();
  });

  it('renders profile suitability badges', () => {
    renderCard();
    expect(screen.getByText('conservative')).toBeInTheDocument();
  });

  it('renders status badge and grays out invalidated signals', () => {
    const signal = buildSignal();
    signal.status = 'INVALIDATED';
    const { container } = renderCard({ signal });
    expect(screen.getByText('INVALIDATED')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('grayscale');
  });

  it('renders active status badge in green', () => {
    const signal = buildSignal();
    signal.status = 'ACTIVE';
    renderCard({ signal });
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('displays entry zone with low, high and optimal price', () => {
    renderCard();
    expect(screen.getByText(/Zone d'entrée/i)).toBeInTheDocument();
    expect(screen.getByText(/Optimal/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$50000\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\$49000\.00/).length).toBeGreaterThanOrEqual(1);
  });
});
