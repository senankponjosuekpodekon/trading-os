export interface User {
  id: string;
  email: string;
  name: string;
  role: 'TRADER' | 'INVESTOR' | 'ADMIN' | 'SUPER_ADMIN';
  isActive: boolean;
  timezone?: string;
  createdAt: string;
}

export interface Portfolio {
  id: string;
  name: string;
  type: 'PAPER' | 'LIVE';
  currency: string;
  initialCapital: string;
  currentCapital: string;
  userId: string;
  createdAt: string;
  positions?: Position[];
}

export interface Position {
  id: string;
  portfolioId: string;
  assetId: string;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED' | 'CANCELLED';
  direction: 'BUY' | 'SELL';
  entryPrice: string;
  exitPrice?: string;
  quantity: string;
  stopLoss?: string;
  takeProfit?: string;
  takeProfit2?: string;
  trailingStop?: string;
  trailingMethod?: 'atr' | 'swing' | 'ema' | 'chandelier';
  trailingActive?: boolean;
  pnl?: string;
  pnlPercent?: string;
  openedAt: string;
  closedAt?: string;
  asset?: { symbol: string; name: string };
  signalId?: string;
}

export interface PortfolioSummary {
  open: number;
  closed: number;
  totalPnl: number;
  winRate: number;
  positions: Position[];
}

export interface JournalEntry {
  id: string;
  userId: string;
  positionId?: string;
  title: string;
  content: string;
  emotion?: string;
  grade?: number;
  tags: string[];
  createdAt: string;
  position?: { asset?: { symbol: string } };
}

export interface PatternStats {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
  avgDuration: number | null;
  avgConfluence: number | null;
  avgRealizedPnl: number | null;
  avgExpectedPnl: number | null;
}

export interface PatternStatsResponse {
  total: number;
  patterns: Record<string, PatternStats>;
}

export interface PostTradeAnalysis {
  sampleSize: number;
  avgExpectedPnlPct: number;
  avgRealizedPnlPct: number;
  bias: number;
  overestimating: boolean;
  underestimating: boolean;
}

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH';

export interface ExpectedMoveRange {
  horizon: number;
  move: number;
  move_pct: number;
  upper: number;
  lower: number;
}

export interface ExpectedMoveResponse {
  symbol: string;
  timeframe: string;
  close: number;
  atr: number;
  atr_pct: number;
  atr_percentile: number;
  volatility_regime: VolatilityRegime;
  volume_ratio?: number | null;
  ranges: ExpectedMoveRange[];
}

export interface ExpectedMoveSummary {
  move?: number | null;
  move_pct?: number | null;
  horizon?: number | null;
  upper?: number | null;
  lower?: number | null;
  volatility_regime?: string | null;
  atr_pct?: number | null;
}

export interface Signal {
  id: string;
  assetId: string;
  strategyId: string;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  confidence: number;
  timeframe: string;
  entryPrice?: string;
  stopLoss?: string;
  takeProfit1?: string;
  takeProfit2?: string;
  takeProfit3?: string;
  tpProbabilities?: { price: number; rr: number; probability: number }[];
  riskReward?: number;
  profileSuitability?: string[];
  status?: string;
  explanation?: string;
  createdAt: string;
  asset?: { symbol: string; name: string };
  strategy?: { name: string };
  metadata?: {
    price_action?: {
      trend?: string;
      structure?: string;
      bos?: boolean;
      bos_dir?: string;
      choch?: boolean;
      last_swing_high?: number;
      last_swing_low?: number;
    };
    sr_zones?: {
      supports?: { price: number; strength: number }[];
      resistances?: { price: number; strength: number }[];
      near_support?: { price: number; strength: number } | null;
      near_resistance?: { price: number; strength: number } | null;
    };
    patterns?: {
      pin_bar?: string | null;
      engulfing?: string | null;
      doji?: boolean;
      inside_bar?: boolean;
    };
    regime?: {
      regime?: string;
      adx?: number;
      trend_strength?: string;
      above_ema200?: boolean;
      description?: string;
    };
    mtf_context?: {
      ltf?: string;
      mtf?: string;
      htf?: string;
      mtf_regime?: string;
      htf_regime?: string;
      mtf_adx?: number;
      htf_adx?: number;
      mtf_aligned?: boolean | null;
      htf_aligned?: boolean | null;
      confluence?: 'FULL' | 'PARTIAL' | 'NONE' | 'UNKNOWN';
    };
    smc?: {
      fvg?: {
        bullish?: { top: number; bottom: number; mid: number }[];
        bearish?: { top: number; bottom: number; mid: number }[];
        near_bullish_fvg?: { top: number; bottom: number; mid: number } | null;
        near_bearish_fvg?: { top: number; bottom: number; mid: number } | null;
        total_open?: number;
      };
      ob?: {
        bullish?: { top: number; bottom: number; mid: number }[];
        bearish?: { top: number; bottom: number; mid: number }[];
        near_bullish_ob?: { top: number; bottom: number; mid: number } | null;
        near_bearish_ob?: { top: number; bottom: number; mid: number } | null;
        displacement_ratio?: number;
        status?: string;
      };
      liquidity?: {
        equal_highs?: { price: number; touches: number }[];
        equal_lows?:  { price: number; touches: number }[];
        near_eqh?: { price: number; touches: number } | null;
        near_eql?: { price: number; touches: number } | null;
      };
    };
    expected_move_summary?: ExpectedMoveSummary | null;
    expected_move_engine?: ExpectedMoveResponse | null;
    ml_confidence?: number | null;
    ml_regime?: 'LOW' | 'NORMAL' | 'HIGH' | string | null;
    token_grade?: {
      overall_grade: number;
      grade_label: string;
      technical_score: number;
      onchain_score: number;
      social_score: number;
      tokenomics_score: number;
    } | null;
  };
}

export interface AuthResponse {
  user: User;
  access_token: string;
}
