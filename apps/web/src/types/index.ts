export interface User {
  id: string;
  email: string;
  name: string;
  role: 'TRADER' | 'INVESTOR' | 'ADMIN';
  isActive: boolean;
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
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  direction: 'BUY' | 'SELL';
  entryPrice: string;
  exitPrice?: string;
  quantity: string;
  stopLoss?: string;
  takeProfit?: string;
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
  riskReward?: number;
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
      };
      liquidity?: {
        equal_highs?: { price: number; touches: number }[];
        equal_lows?:  { price: number; touches: number }[];
        near_eqh?: { price: number; touches: number } | null;
        near_eql?: { price: number; touches: number } | null;
      };
    };
  };
}

export interface AuthResponse {
  user: User;
  access_token: string;
}
