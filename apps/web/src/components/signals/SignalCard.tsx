'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, TrendingDown, Minus, Brain, BarChart2, ChevronUp, ChevronDown,
  Newspaper, ExternalLink, AlertTriangle, CheckCircle2, Target, ShieldAlert, Layers,
  Waves, Activity, ArrowUpRight, History,
} from 'lucide-react';
import { ExpectedMoveResponse, Signal } from '@/types';
import { useModeStore } from '@/store/mode.store';
import { RegimeBadge } from '@/components/ui/RegimeBadge';
import { AssetTypeBadge } from '@/components/ui/AssetTypeBadge';
import { RiskLevelBadge } from '@/components/ui/RiskLevelBadge';
import { ProbabilityBar } from '@/components/ui/ProbabilityBar';
import { OpportunityScore } from '@/components/ui/OpportunityScore';
import { ConfidenceGauge } from '@/components/ui/ConfidenceGauge';
import { RRRatioBadge } from '@/components/ui/RRRatioBadge';
import { TimeAgo } from '@/components/ui/TimeAgo';
import { formatDateTime, getTradingSession } from '@/lib/timezone';
import { useAuthStore } from '@/store/auth.store';
import { Clock, Zap, Crosshair } from 'lucide-react';
import { OneClickExecute } from './OneClickExecute';

const SYMBOL_TO_PRICE_KEY: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
  'BNB/USDT': 'BNBUSDT', 'AVAX/USDT': 'AVAXUSDT', 'ADA/USDT': 'ADAUSDT',
  'DOT/USDT': 'DOTUSDT', 'LINK/USDT': 'LINKUSDT', 'MATIC/USDT': 'MATICUSDT',
  'ATOM/USDT': 'ATOMUSDT', 'LTC/USDT': 'LTCUSDT', 'XRP/USDT': 'XRPUSDT',
  'DOGE/USDT': 'DOGEUSDT', 'TRX/USDT': 'TRXUSDT', 'TON/USDT': 'TONUSDT', 'PAXG/USDT': 'PAXGUSDT',
  'EUR/USD': 'EUR/USD', 'GBP/USD': 'GBP/USD', 'USD/JPY': 'USD/JPY',
  'AUD/USD': 'AUD/USD', 'USD/CHF': 'USD/CHF', 'USD/CAD': 'USD/CAD', 'NZD/USD': 'NZD/USD',
  'XAU/USD': 'XAU/USD', 'XAG/USD': 'XAG/USD', 'WTI/USD': 'WTI/USD', 'BRENT/USD': 'BRENT/USD',
  // Legacy Deriv format
  'VIX10/USD': 'VIX10/USD', 'VIX25/USD': 'VIX25/USD', 'VIX50/USD': 'VIX50/USD',
  'VIX75/USD': 'VIX75/USD', 'VIX100/USD': 'VIX100/USD',
  'BOOM300/USD': 'BOOM300/USD', 'BOOM500/USD': 'BOOM500/USD', 'BOOM1000/USD': 'BOOM1000/USD',
  'CRASH300/USD': 'CRASH300/USD', 'CRASH500/USD': 'CRASH500/USD', 'CRASH1000/USD': 'CRASH1000/USD',
  'JUMP10/USD': 'JUMP10/USD', 'JUMP25/USD': 'JUMP25/USD', 'JUMP50/USD': 'JUMP50/USD',
  'JUMP75/USD': 'JUMP75/USD', 'JUMP100/USD': 'JUMP100/USD',
  // Short format (matches seeded asset symbols)
  'V10': 'V10', 'V25': 'V25', 'V50': 'V50', 'V75': 'V75', 'V100': 'V100',
  'BOOM300': 'BOOM300', 'BOOM500': 'BOOM500', 'BOOM1000': 'BOOM1000',
  'CRASH300': 'CRASH300', 'CRASH500': 'CRASH500', 'CRASH1000': 'CRASH1000',
  'JUMP10': 'JUMP10', 'JUMP25': 'JUMP25', 'JUMP50': 'JUMP50',
  'JUMP75': 'JUMP75', 'JUMP100': 'JUMP100',
};

export interface SignalCardProps {
  signal: Signal;
  prices: Record<string, number>;
  aiExplain?: string;
  loadingAi?: boolean;
  onExplain?: (id: string) => void;
}

export function SignalCard({ signal, prices, aiExplain, loadingAi, onExplain }: SignalCardProps) {
  const mode = useModeStore(s => s.mode);
  const isBeginner = mode === 'beginner';
  const user = useAuthStore(s => s.user);
  const [showWhy, setShowWhy] = useState(false);
  const [showWhyNot, setShowWhyNot] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  const userTz = user?.timezone;
  const safeCreatedAt = signal.createdAt ?? new Date().toISOString();
  const exactTime = formatDateTime(safeCreatedAt, userTz);
  const session = getTradingSession(safeCreatedAt);
  const dps = (signal.metadata as any)?.dps;
  const analysisTf = (signal.metadata as any)?.analysisTimeframe ?? (signal as any).analysisTimeframe;
  const entryTf = (signal.metadata as any)?.entryTimeframe ?? (signal as any).entryTimeframe;

  const detectedPatterns = (signal.metadata as any)?.detectedPatterns ?? [];

  const pa = signal.metadata?.price_action ?? {};
  const sr = signal.metadata?.sr_zones ?? {};
  const pats = signal.metadata?.patterns ?? {};
  const regime = signal.metadata?.regime ?? {};
  const smc = signal.metadata?.smc ?? {};
  const mtf = signal.metadata?.mtf_context ?? {};
  const fvg = smc.fvg ?? {};
  const ob = smc.ob ?? {};
  const liq = smc.liquidity ?? {};
  const news = (signal.metadata as any)?.news_sentiment;
  const marketContext = (signal.metadata as any)?.marketContext ?? {};
  const expectedMoveEngine = (signal.metadata as any)?.expected_move_engine as ExpectedMoveResponse | null;
  const expectedMoveSummary = (signal.metadata as any)?.expected_move_summary ?? null;
  const expectedMoveRange = expectedMoveEngine?.ranges?.find(r => r.horizon === 5) ?? expectedMoveEngine?.ranges?.[0];
  const expectedMoveDisplay = expectedMoveSummary ?? (expectedMoveRange ? {
    move: expectedMoveRange.move,
    move_pct: expectedMoveRange.move_pct,
    horizon: expectedMoveRange.horizon,
    upper: expectedMoveRange.upper,
    lower: expectedMoveRange.lower,
    volatility_regime: expectedMoveEngine?.volatility_regime,
    atr_pct: expectedMoveEngine?.atr_pct,
  } : null);

  const isBuy = signal.signal === 'BUY';
  const isSell = signal.signal === 'SELL';

  const livePriceKey = SYMBOL_TO_PRICE_KEY[signal.asset?.symbol ?? ''] ?? (signal.asset?.symbol ?? '');
  const livePrice = prices[livePriceKey] ?? null;

  const entry = signal.entryPrice ? parseFloat(signal.entryPrice) : null;
  const sl = signal.stopLoss ? parseFloat(signal.stopLoss) : null;
  const tp1 = signal.takeProfit1 ? parseFloat(signal.takeProfit1) : null;
  const tp2 = signal.takeProfit2 ? parseFloat(signal.takeProfit2) : null;
  const tp3 = signal.takeProfit3 ? parseFloat(signal.takeProfit3) : null;

  const entryZone = useMemo(() => computeEntryZone(signal), [signal]);
  const tpProbs = useMemo(() => computeTpProbs(signal), [signal]);
  const opportunityScore = useMemo(() => computeOpportunityScore(signal), [signal]);

  const deltaVsEntry = livePrice && entry ? ((livePrice - entry) / entry) * 100 : null;

  const beginnerSummary = useMemo(() => buildBeginnerSummary(signal), [signal]);
  const whyPoints = useMemo(() => buildWhyPoints(signal), [signal]);
  const whyNotPoints = useMemo(() => buildWhyNotPoints(signal), [signal]);

  const status = signal.status;
  const isInvalidated = status === 'INVALIDATED';
  const statusStyle =
    status === 'ACTIVE' ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' :
    status === 'PENDING' ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20' :
    isInvalidated ? 'bg-red-400/10 text-red-400 border-red-400/20' :
    'bg-gray-700 text-gray-300 border-gray-600';

  return (
    <div
      className={`bg-gray-900 border rounded-xl p-5 hover:border-gray-700 transition-colors ${
        isBuy ? 'border-l-2 border-l-emerald-500 border-gray-800' :
        isSell ? 'border-l-2 border-l-red-500 border-gray-800' :
        'border-gray-800'
      } ${isInvalidated ? 'opacity-60 grayscale' : ''}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-lg">{signal.asset?.symbol ?? '—'}</span>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{signal.timeframe}</span>
            <AssetTypeBadge type={inferAssetType(signal.asset?.symbol)} />
            {signal.metadata?.risk_level && (
              <RiskLevelBadge
                level={signal.metadata.risk_level}
                reasons={signal.metadata.risk_level_reasons}
              />
            )}
            {signal.metadata?.market_cap_tier && (
              <span className="text-xs px-2 py-0.5 rounded border border-gray-600/30 bg-gray-700/30 text-gray-400 font-medium">
                {signal.metadata.market_cap_tier}
              </span>
            )}
            {signal.metadata?.red_flags && signal.metadata.red_flags.red_flag_count > 0 && (
              <span
                className={`text-xs px-2 py-0.5 rounded border font-medium ${
                  signal.metadata.red_flags.danger
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : 'border-orange-500/30 bg-orange-500/10 text-orange-400'
                }`}
                title={signal.metadata.red_flags.red_flags.join(', ')}
              >
                ⚠ {signal.metadata.red_flags.red_flag_count} red flags
              </span>
            )}
            {signal.profileSuitability?.map(p => (
              <span key={p} className="text-xs px-2 py-0.5 rounded border border-indigo-400/30 bg-indigo-400/10 text-indigo-300 font-medium">{p}</span>
            ))}
            {status && (
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${statusStyle}`}>
                {status}
              </span>
            )}
            {(signal as any).signal_pending && (
              <span className="text-xs px-2 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400">⏳ Confirmation</span>
            )}
            {(signal as any).signal_sticky && (
              <span className="text-xs px-2 py-0.5 rounded border border-gray-500/30 bg-gray-700/50 text-gray-400">📌 Maintenu</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-gray-500 text-xs">
            <TimeAgo date={safeCreatedAt} />
            <span className="text-gray-600">·</span>
            <span className="flex items-center gap-1" title={new Date(safeCreatedAt).toISOString()}>
              <Clock className="w-3 h-3" />{exactTime}
            </span>
            {signal.strategy?.name && (
              <>
                <span className="text-gray-600">·</span>
                <span className="text-indigo-400/80">{signal.strategy.name}</span>
              </>
            )}
          </div>
          {/* Sub-line: session + TFs + DPS */}
          <div className="flex items-center gap-2 text-[11px] text-gray-600 mt-0.5">
            {session && (
              <span className="flex items-center gap-0.5">
                <Crosshair className="w-2.5 h-2.5" />{session}
              </span>
            )}
            {analysisTf && entryTf && analysisTf !== entryTf && (
              <span>Anal: {analysisTf} · Entrée: {entryTf}</span>
            )}
            {dps != null && (
              <span className="flex items-center gap-0.5 text-amber-500/70">
                <Zap className="w-2.5 h-2.5" />DPS {Math.round(dps)}%
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <SignalBadge signal={signal.signal} />
          <ConfidenceGauge value={signal.confidence} size="sm" />
        </div>
      </div>

      {/* Beginner summary */}
      {isBeginner && (
        <div className="mb-4 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
          <p className="text-sm text-gray-200 font-medium">{beginnerSummary.title}</p>
          <p className="text-xs text-gray-400 mt-1">{beginnerSummary.sub}</p>
        </div>
      )}

      {/* Live price */}
      {livePrice !== null && entry !== null && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-gray-800/60 rounded-lg border border-gray-700">
          <span className="text-gray-500 text-xs">Prix actuel</span>
          <span className="text-white font-mono text-sm font-bold">
            ${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
          </span>
          {deltaVsEntry !== null && (
            <span className={`text-xs font-mono font-semibold ml-auto ${deltaVsEntry > 0 ? 'text-emerald-400' : deltaVsEntry < 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {deltaVsEntry >= 0 ? '+' : ''}{deltaVsEntry.toFixed(2)}% vs entrée
            </span>
          )}
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
      )}

      {/* Signal vivant — real-time PnL + progress toward TP/SL */}
      {livePrice !== null && entry !== null && sl !== null && signal.signal !== 'NEUTRAL' && (
        <LiveSignalTracker
          isBuy={isBuy}
          livePrice={livePrice}
          entry={entry}
          sl={sl}
          tp1={tp1}
          tp2={tp2}
          tp3={tp3}
          status={status}
        />
      )}

      {/* Entry zone + optimal entry */}
      {entryZone && (
        <div className="mb-4 p-3 bg-gray-800/40 border border-gray-700/50 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 flex items-center gap-1"><Target className="w-3 h-3" /> Zone d&apos;entrée</span>
            <span className="text-xs font-mono text-emerald-400">Optimal ${entryZone.optimal.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-300 font-mono">${entryZone.low.toFixed(2)}</span>
            <ProbabilityBar value={entryZone.fillPct} max={100} showValue size="sm" className="flex-1" />
            <span className="text-gray-300 font-mono">${entryZone.high.toFixed(2)}</span>
          </div>
        </div>
      )}

      {expectedMoveDisplay && (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-800/40 border border-gray-700/50 rounded-lg p-3" title="Expected Move Engine">
          <div>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Waves className="w-3 h-3" />Régime volatilité
            </p>
            <p className="text-sm text-white font-semibold mt-1">
              {expectedMoveDisplay.volatility_regime ?? expectedMoveEngine?.volatility_regime ?? '—'}
            </p>
            {expectedMoveEngine?.atr_percentile !== undefined && (
              <p className="text-[11px] text-gray-500">ATR perc. {expectedMoveEngine.atr_percentile.toFixed(1)}%</p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Activity className="w-3 h-3" />Expected move
            </p>
            <p className="text-sm text-white font-mono mt-1 flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3 text-emerald-400" />
              {expectedMoveDisplay.move_pct != null ? `±${expectedMoveDisplay.move_pct.toFixed(2)}%` : '—'}
            </p>
            <p className="text-[11px] text-gray-500">
              {expectedMoveDisplay.move != null ? `≈ $${fmtPrice(expectedMoveDisplay.move)}` : ''}
              {expectedMoveDisplay.horizon ? ` · ${expectedMoveDisplay.horizon} barres` : ''}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Plage projetée</p>
            <p className="text-[11px] text-gray-400 mt-1">Upper <span className="text-gray-200 font-mono">${fmtPrice(expectedMoveDisplay.upper ?? expectedMoveRange?.upper ?? null)}</span></p>
            <p className="text-[11px] text-gray-400">Lower <span className="text-gray-200 font-mono">${fmtPrice(expectedMoveDisplay.lower ?? expectedMoveRange?.lower ?? null)}</span></p>
          </div>
        </div>
      )}

      {/* Levels */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Level label="Entrée" value={entry} color="text-white" />
        <Level label="SL" value={sl} color="text-red-400" />
        <Level label="TP1" value={tp1} color="text-emerald-400" />
        <Level label="R/R" value={signal.riskReward ? `${signal.riskReward}x` : null} color="text-yellow-400" />
      </div>

      {/* TP probabilities */}
      {tpProbs.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {tpProbs.map(tp => (
            <div key={tp.label} className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 w-8 font-medium">{tp.label}</span>
              <span className="font-mono text-emerald-400 w-14">${tp.price.toFixed(2)}</span>
              <span className="text-gray-500 w-10">{tp.rr.toFixed(1)}R</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${tp.probability}%` }} />
              </div>
              <span className="text-gray-300 w-8 text-right">{tp.probability}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Confluence + regime */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {mtf.confluence && mtf.confluence !== 'UNKNOWN' && (
          <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
            mtf.confluence === 'FULL' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
            mtf.confluence === 'PARTIAL' ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' :
            'text-red-400 bg-red-400/10 border-red-400/20'
          }`}>
            {mtf.confluence === 'FULL' ? '⬡ FULL' : mtf.confluence === 'PARTIAL' ? '◑ PARTIAL' : '○ NONE'}
          </span>
        )}
        <RegimeBadge regime={regime.regime} />
        {signal.metadata?.ml_regime && (
          <span
            className="text-xs px-2 py-0.5 rounded border border-sky-400/30 bg-sky-500/10 text-sky-200 flex items-center gap-1"
            title="Régime ML (HMM)"
          >
            <span className="text-[10px] uppercase tracking-wide">Regime ML</span>
            <span className="font-mono">{signal.metadata.ml_regime}</span>
          </span>
        )}
        {signal.metadata?.ml_confidence != null && (
          <span
            className="text-xs px-2 py-0.5 rounded border text-violet-400 bg-violet-400/10 border-violet-400/20 flex items-center gap-1"
            title="Confiance du modèle ML (shadow mode) entraîné sur le feature store"
          >
            <span className="text-[10px] uppercase tracking-wide">ML</span>
            <span className="font-mono">{signal.metadata.ml_confidence.toFixed(1)}%</span>
          </span>
        )}
        {signal.metadata?.token_grade && (
          <span
            className="text-xs px-2 py-0.5 rounded border flex items-center gap-1"
            title={`Token Grade — Technical: ${signal.metadata.token_grade.technical_score} · On-chain: ${signal.metadata.token_grade.onchain_score} · Social: ${signal.metadata.token_grade.social_score} · Tokenomics: ${signal.metadata.token_grade.tokenomics_score}`}
            style={{
              color: signal.metadata.token_grade.overall_grade >= 70 ? '#34d399' : signal.metadata.token_grade.overall_grade >= 50 ? '#fbbf24' : '#f87171',
              borderColor: signal.metadata.token_grade.overall_grade >= 70 ? 'rgba(52,211,153,0.2)' : signal.metadata.token_grade.overall_grade >= 50 ? 'rgba(251,191,36,0.2)' : 'rgba(248,113,113,0.2)',
              backgroundColor: signal.metadata.token_grade.overall_grade >= 70 ? 'rgba(52,211,153,0.1)' : signal.metadata.token_grade.overall_grade >= 50 ? 'rgba(251,191,36,0.1)' : 'rgba(248,113,113,0.1)',
            }}
          >
            <span className="text-[10px] uppercase tracking-wide">Grade</span>
            <span className="font-mono font-bold">{signal.metadata.token_grade.overall_grade}</span>
            <span className="text-[10px] opacity-70">{signal.metadata.token_grade.grade_label}</span>
          </span>
        )}
        {regime.adx !== undefined && (
          <span className="text-xs text-gray-500">ADX {regime.adx}</span>
        )}
        <RRRatioBadge riskReward={signal.riskReward ? parseFloat(String(signal.riskReward)) : undefined} />
        {!isBeginner && <OpportunityScore score={opportunityScore} />}
      </div>

      {/* PA / SMC / Patterns badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {pa.trend && pa.trend !== 'NEUTRAL' && (
          <span className={`text-xs px-2 py-0.5 rounded border font-medium ${pa.trend === 'BULLISH' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
            {pa.trend === 'BULLISH' ? '↑' : '↓'} {pa.structure?.split(' ')[0]}
          </span>
        )}
        {pa.bos && <span className="text-xs px-2 py-0.5 rounded border text-blue-400 bg-blue-400/10 border-blue-400/20 font-medium">BOS {pa.bos_dir}</span>}
        {pa.choch && <span className="text-xs px-2 py-0.5 rounded border text-purple-400 bg-purple-400/10 border-purple-400/20 font-medium">CHoCH</span>}
        {pats.pin_bar && <span className="text-xs px-2 py-0.5 rounded border text-yellow-400 bg-yellow-400/10 border-yellow-400/20">Pin Bar {pats.pin_bar}</span>}
        {pats.engulfing && <span className="text-xs px-2 py-0.5 rounded border text-orange-400 bg-orange-400/10 border-orange-400/20">Engulfing {pats.engulfing}</span>}
        {pats.inside_bar && <span className="text-xs px-2 py-0.5 rounded border text-gray-400 bg-gray-400/10 border-gray-600">Inside Bar</span>}
        {pats.doji && <span className="text-xs px-2 py-0.5 rounded border text-gray-400 bg-gray-700 border-gray-600">Doji</span>}
        {sr.near_support && <span className="text-xs px-2 py-0.5 rounded border text-emerald-400 bg-emerald-400/10 border-emerald-400/20">Support ${sr.near_support.price?.toFixed(0)}</span>}
        {sr.near_resistance && <span className="text-xs px-2 py-0.5 rounded border text-red-400 bg-red-400/10 border-red-400/20">Résist. ${sr.near_resistance.price?.toFixed(0)}</span>}
        {fvg.near_bullish_fvg && <span className="text-xs px-2 py-0.5 rounded border text-cyan-400 bg-cyan-400/10 border-cyan-400/20 font-medium" title={`FVG ${fvg.near_bullish_fvg.bottom?.toFixed(2)}–${fvg.near_bullish_fvg.top?.toFixed(2)}`}>FVG Bull</span>}
        {fvg.near_bearish_fvg && <span className="text-xs px-2 py-0.5 rounded border text-rose-400 bg-rose-400/10 border-rose-400/20 font-medium" title={`FVG ${fvg.near_bearish_fvg.bottom?.toFixed(2)}–${fvg.near_bearish_fvg.top?.toFixed(2)}`}>FVG Bear</span>}
        {ob.near_bullish_ob && <span className="text-xs px-2 py-0.5 rounded border text-teal-400 bg-teal-400/10 border-teal-400/20 font-medium" title={`OB ${ob.near_bullish_ob.bottom?.toFixed(2)}–${ob.near_bullish_ob.top?.toFixed(2)}`}>OB Bull</span>}
        {ob.near_bearish_ob && <span className="text-xs px-2 py-0.5 rounded border text-pink-400 bg-pink-400/10 border-pink-400/20 font-medium" title={`OB ${ob.near_bearish_ob.bottom?.toFixed(2)}–${ob.near_bearish_ob.top?.toFixed(2)}`}>OB Bear</span>}
        {liq.near_eqh && <span className="text-xs px-2 py-0.5 rounded border text-violet-400 bg-violet-400/10 border-violet-400/20" title={`${liq.near_eqh.touches} touches`}>EQH Liq</span>}
        {liq.near_eql && <span className="text-xs px-2 py-0.5 rounded border text-violet-400 bg-violet-400/10 border-violet-400/20" title={`${liq.near_eql.touches} touches`}>EQL Liq</span>}
        {detectedPatterns.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded border text-indigo-400 bg-indigo-400/10 border-indigo-400/20 font-medium">
            {detectedPatterns[0].name} ({Math.round((detectedPatterns[0].confluenceScore ?? detectedPatterns[0].confidence ?? 0) * 100)}%)
          </span>
        )}
      </div>

      {/* Explanation */}
      <p className="text-gray-500 text-xs leading-relaxed line-clamp-2 mb-3" title={signal.explanation ?? ''}>
        {signal.explanation ?? '—'}
      </p>

      {/* AI Defense alert */}
      {(signal.metadata as any)?.ai_defense && (signal.metadata as any).ai_defense.alert_count > 0 && (
        <div className="mb-3 p-2 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <ShieldAlert className="w-3 h-3" />
            <span className="font-medium">AI Defense: {(signal.metadata as any).ai_defense.recommendation}</span>
            <span className="text-gray-500">· {(signal.metadata as any).ai_defense.alert_count} alerts</span>
          </div>
          {(signal.metadata as any).ai_defense.alerts?.[0] && (
            <p className="text-[11px] text-red-400/70 mt-1">{(signal.metadata as any).ai_defense.alerts[0].message}</p>
          )}
        </div>
      )}

      {/* X Sentiment + On-chain signals */}
      {(signal.metadata as any)?.x_sentiment && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Newspaper className="w-3 h-3" /> X Sentiment
          </span>
          <span className={`text-xs px-2 py-0.5 rounded border font-medium capitalize ${
            (signal.metadata as any).x_sentiment.overall_label === 'positive' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
            (signal.metadata as any).x_sentiment.overall_label === 'negative' ? 'text-red-400 bg-red-400/10 border-red-400/20' :
            'text-gray-400 bg-gray-700 border-gray-600'
          }`}>
            {(signal.metadata as any).x_sentiment.overall_label ?? 'neutral'}
          </span>
          <span className="text-xs text-gray-500">
            {(signal.metadata as any).x_sentiment.tweet_count} tweets · {(signal.metadata as any).x_sentiment.source}
          </span>
        </div>
      )}

      {(signal.metadata as any)?.onchain_signals && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Activity className="w-3 h-3" /> On-chain
          </span>
          <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
            (signal.metadata as any).onchain_signals.signal_score >= 70 ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
            (signal.metadata as any).onchain_signals.signal_score >= 40 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' :
            'text-red-400 bg-red-400/10 border-red-400/20'
          }`}>
            {(signal.metadata as any).onchain_signals.verdict ?? '—'} · {(signal.metadata as any).onchain_signals.signal_score}
          </span>
          {(signal.metadata as any).onchain_signals.whale_accumulation && (
            <span className="text-xs text-cyan-400">🐳 Whale accum</span>
          )}
          {(signal.metadata as any).onchain_signals.liquidity_building && (
            <span className="text-xs text-blue-400">💧 Liq building</span>
          )}
          {(signal.metadata as any).onchain_signals.dev_activity && (
            <span className="text-xs text-violet-400">💻 Dev active</span>
          )}
        </div>
      )}

      {/* News sentiment */}
      {news && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Newspaper className="w-3 h-3 text-gray-500" />
            <span className="text-xs text-gray-500">Sentiment news</span>
            <span className={`text-xs px-2 py-0.5 rounded border font-medium capitalize ${
              news.label === 'bullish' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
              news.label === 'bearish' ? 'text-red-400 bg-red-400/10 border-red-400/20' :
              'text-gray-400 bg-gray-700 border-gray-600'
            }`}>
              {news.label}
            </span>
            <span className={`text-xs font-mono font-bold ${news.bonus > 0 ? 'text-emerald-400' : news.bonus < 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {news.bonus > 0 ? '+' : ''}{news.bonus}pts
            </span>
          </div>
          {news.articles?.length > 0 && (
            <div className="space-y-1">
              {news.articles.slice(0, 2).map((a: any, i: number) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1.5 group">
                  <ExternalLink className="w-2.5 h-2.5 text-gray-600 group-hover:text-violet-400 mt-0.5 shrink-0" />
                  <span className="text-xs text-gray-500 group-hover:text-gray-300 line-clamp-1 transition-colors">{a.title}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detected chart / harmonic patterns */}
      {detectedPatterns.length > 0 && !isBeginner && (
        <div className="mb-3">
          <Expandable
            title="Patterns détectés"
            icon={<Layers className="w-3.5 h-3.5 text-indigo-400" />}
            open={showPatterns}
            onToggle={() => setShowPatterns(v => !v)}
          >
            <div className="space-y-2">
              {detectedPatterns.slice(0, 3).map((p: any, i: number) => (
                <div key={i} className="text-xs border-l-2 border-indigo-500/40 pl-2.5 py-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-200 capitalize">{p.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        p.direction === 'BUY' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'
                      }`}>
                        {p.direction}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-indigo-300">
                      C={Math.round((p.confluenceScore ?? p.confidence ?? 0) * 100)}%
                    </span>
                  </div>
                  {p.prz && (
                    <div className="text-gray-400 mb-1">
                      PRZ: <span className="font-mono text-gray-300">${fmtPrice(p.prz.min)}–${fmtPrice(p.prz.max)}</span>
                    </div>
                  )}
                  {Array.isArray(p.targets) && p.targets.length > 0 && (
                    <div className="text-gray-400 mb-1">
                      Fib Targets: {p.targets.map((t: number, j: number) => (
                        <span key={j} className="font-mono text-gray-300 mr-1.5">${fmtPrice(t)}</span>
                      ))}
                    </div>
                  )}
                  {p.stopLoss !== undefined && p.entry !== undefined && (
                    <div className="text-gray-400 mb-1">
                      Entry <span className="font-mono text-gray-300">${fmtPrice(p.entry)}</span>
                      {' · '}SL <span className="font-mono text-red-400">${fmtPrice(p.stopLoss)}</span>
                    </div>
                  )}
                  {p.confluenceTags && p.confluenceTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.confluenceTags.map((tag: string, j: number) => (
                        <span key={j} className="px-1.5 py-0.5 rounded bg-gray-800 text-[10px] text-gray-400 border border-gray-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.reason && (
                    <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">{p.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </Expandable>
        </div>
      )}

      {/* Why / Why not decision trace */}
      {!isBeginner && (
        <div className="mb-3 space-y-2">
          <Expandable title="Pourquoi ce trade ?" icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />} open={showWhy} onToggle={() => setShowWhy(v => !v)}>
            <ul className="space-y-1">
              {whyPoints.map((p, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-xs text-gray-400">
                  <span className="flex items-start gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 shrink-0" /> {p.label}
                  </span>
                  {p.score !== undefined && <span className="text-emerald-400/80 font-mono text-[10px]">+{p.score}</span>}
                </li>
              ))}
              {whyPoints.length === 0 && <li className="text-xs text-gray-600">Aucun facteur technique fort détecté.</li>}
            </ul>
          </Expandable>
          <Expandable title="Pourquoi PAS ?" icon={<AlertTriangle className="w-3.5 h-3.5 text-red-400" />} open={showWhyNot} onToggle={() => setShowWhyNot(v => !v)}>
            <ul className="space-y-1">
              {whyNotPoints.map((p, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-xs text-gray-400">
                  <span className="flex items-start gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-red-400 mt-1.5 shrink-0" /> {p.label}
                  </span>
                  {p.score !== undefined && <span className="text-red-400/80 font-mono text-[10px]">-{p.score}</span>}
                </li>
              ))}
              {whyNotPoints.length === 0 && <li className="text-xs text-gray-600">Aucun risque majeur identifié.</li>}
            </ul>
          </Expandable>
        </div>
      )}

      {/* Signal Timeline — key events history */}
      {!isBeginner && signal.signal !== 'NEUTRAL' && (
        <div className="mb-3">
          <Expandable title="Timeline" icon={<History className="w-3.5 h-3.5 text-gray-400" />} open={showTimeline} onToggle={() => setShowTimeline(v => !v)}>
            <SignalTimeline signal={signal} livePrice={livePrice} />
          </Expandable>
        </div>
      )}

      {/* Actions */}
      {signal.signal !== 'NEUTRAL' && (
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={`/chart/${encodeURIComponent(signal.asset?.symbol ?? 'BTC/USDT')}?tf=${signal.timeframe}`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 bg-gray-800/50 hover:bg-gray-700 hover:text-white transition-colors font-medium"
            >
              <BarChart2 className="w-3 h-3" />Voir chart
            </Link>
            <OneClickExecute signal={signal} />
            {onExplain && (
              <button
                onClick={() => onExplain(signal.id)}
                disabled={loadingAi}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-50 transition-colors font-medium"
              >
                {loadingAi ? (
                  <>Analyse IA...</>
                ) : aiExplain ? (
                  <><ChevronUp className="w-3 h-3" />Masquer l&apos;IA</>
                ) : (
                  <><Brain className="w-3 h-3" />Expliquer avec l&apos;IA</>
                )}
              </button>
            )}
          </div>
          {aiExplain && (
            <div className="mt-2 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Brain className="w-3 h-3 text-violet-400" />
                <span className="text-xs font-medium text-violet-400">Analyse IA</span>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed">{aiExplain}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Level({ label, value, color }: { label: string; value: number | string | null; color: string }) {
  const display = typeof value === 'number' && !Number.isNaN(value)
    ? `$${value.toFixed(2)}`
    : value ?? '—';
  return (
    <div className="bg-gray-800 rounded-lg p-2 text-center">
      <p className="text-gray-500 text-xs mb-0.5">{label}</p>
      <p className={`font-mono text-xs font-semibold ${color}`}>{display}</p>
    </div>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === 'BUY') return <span className="flex items-center gap-1 text-emerald-400 font-bold text-sm"><TrendingUp className="w-3.5 h-3.5" />BUY</span>;
  if (signal === 'SELL') return <span className="flex items-center gap-1 text-red-400 font-bold text-sm"><TrendingDown className="w-3.5 h-3.5" />SELL</span>;
  return <span className="flex items-center gap-1 text-gray-500 text-sm"><Minus className="w-3.5 h-3.5" />NEUTRAL</span>;
}

function Expandable({ title, icon, open, onToggle, children }: {
  title: string; icon: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800/50 transition-colors">
        <span className="flex items-center gap-1.5">{icon}{title}</span>
        {open ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

function computeTpProbs(s: Signal) {
  const entry = s.entryPrice ? parseFloat(s.entryPrice) : null;
  const sl = s.stopLoss ? parseFloat(s.stopLoss) : null;
  const tp1 = s.takeProfit1 ? parseFloat(s.takeProfit1) : null;
  const tp2 = s.takeProfit2 ? parseFloat(s.takeProfit2) : null;
  const tp3 = s.takeProfit3 ? parseFloat(s.takeProfit3) : null;
  if (!entry || !sl) return [];
  const isBuy = s.signal === 'BUY';
  const dist = Math.abs(entry - sl);
  const baseR = s.riskReward ? parseFloat(String(s.riskReward)) : (tp1 ? Math.abs(tp1 - entry) / dist : 2);
  const prices = [tp1, tp2, tp3].map((price, i) =>
    price ?? entry + (isBuy ? 1 : -1) * baseR * (i + 1) * dist
  );
  const conf = s.confidence ?? 50;
  return prices.map((price, i) => {
    const decay = [0, 15, 35][i];
    const probability = Math.max(5, Math.min(95, Math.round(conf - decay)));
    return { label: `TP${i + 1}`, price, rr: baseR * (i + 1), probability };
  });
}

function computeEntryZone(s: Signal) {
  const entry = s.entryPrice ? parseFloat(s.entryPrice) : null;
  const sl = s.stopLoss ? parseFloat(s.stopLoss) : null;
  if (!entry || !sl) return null;
  const isBuy = s.signal === 'BUY';
  const dist = Math.abs(entry - sl);
  const smc = s.metadata?.smc ?? {};
  const fvg = smc.fvg ?? {};
  const ob = smc.ob ?? {};
  let low = isBuy ? entry - dist * 0.15 : entry;
  let high = isBuy ? entry : entry + dist * 0.15;

  const bullFvg = fvg.near_bullish_fvg;
  const bearFvg = fvg.near_bearish_fvg;
  const bullOb = ob.near_bullish_ob;
  const bearOb = ob.near_bearish_ob;

  if (isBuy && bullFvg) { low = bullFvg.bottom; high = bullFvg.top; }
  if (!isBuy && bearFvg) { low = bearFvg.bottom; high = bearFvg.top; }
  if (isBuy && bullOb && !bullFvg) { low = Math.min(low, bullOb.bottom); high = Math.max(high, bullOb.top); }
  if (!isBuy && bearOb && !bearFvg) { low = Math.min(low, bearOb.bottom); high = Math.max(high, bearOb.top); }

  const optimal = (low + high) / 2;
  const fillPct = s.metadata?.smc?.ob?.displacement_ratio ? Math.round(s.metadata.smc.ob.displacement_ratio * 100) : 50;
  return { low, high, optimal, fillPct };
}

function computeOpportunityScore(s: Signal): number {
  const conf = s.confidence ?? 50;
  const rr = s.riskReward ? parseFloat(String(s.riskReward)) : 2;
  const mtf = s.metadata?.mtf_context ?? {};
  const mtfBonus = mtf.confluence === 'FULL' ? 1.25 : mtf.confluence === 'PARTIAL' ? 1 : 0.85;
  const score = Math.min(100, conf * Math.min(rr, 5) * mtfBonus / 2);
  return Math.round(score);
}

function buildBeginnerSummary(s: Signal): { title: string; sub: string } {
  const dir = s.signal === 'BUY' ? 'achat' : s.signal === 'SELL' ? 'vente' : 'neutre';
  const conf = Math.round(s.confidence);
  const rr = s.riskReward ? parseFloat(String(s.riskReward)).toFixed(1) : '?';
  const title = `${dir.toUpperCase()} ${s.asset?.symbol} · confiance ${conf}% · R/R 1:${rr}`;
  const sub = s.explanation ? s.explanation.split('.')[0] : 'Signal généré par le moteur d’analyse.';
  return { title, sub };
}

function buildWhyPoints(s: Signal): { label: string; score?: number }[] {
  const trace = (s.metadata as any)?.decisionTrace;
  if (trace?.why?.length) return trace.why;
  const pts: { label: string; score?: number }[] = [];
  const pa = s.metadata?.price_action ?? {};
  const mtf = s.metadata?.mtf_context ?? {};
  const smc = s.metadata?.smc ?? {};
  const pats = s.metadata?.patterns ?? {};
  if (pa.bos) pts.push({ label: `Break of Structure (${pa.bos_dir}) confirmé` });
  if (pa.choch) pts.push({ label: 'Change of Character détecté' });
  if (mtf.confluence === 'FULL') pts.push({ label: 'Confluence multi-timeframe complète' });
  if (mtf.mtf_aligned) pts.push({ label: `Alignement ${mtf.mtf} avec le setup` });
  if (smc.ob?.near_bullish_ob || smc.ob?.near_bearish_ob) pts.push({ label: 'Order Block proche du prix actuel' });
  if (smc.fvg?.near_bullish_fvg || smc.fvg?.near_bearish_fvg) pts.push({ label: 'Fair Value Gap exploitable' });
  if (smc.liquidity?.near_eqh || smc.liquidity?.near_eql) pts.push({ label: 'Liquidité majeure proche (EQH/EQL)' });
  if (pats.pin_bar) pts.push({ label: 'Pin bar de confirmation' });
  if (pats.engulfing) pts.push({ label: 'Engulfing de confirmation' });

  // ── Dynamic: Token Grade ──
  const tg = (s.metadata as any)?.token_grade;
  if (tg && tg.overall_grade >= 70) pts.push({ label: `Token Grade élevé (${tg.overall_grade}/100 — ${tg.grade_label})`, score: 10 });

  // ── Dynamic: X Sentiment ──
  const xs = (s.metadata as any)?.x_sentiment;
  if (xs && xs.overall_label === 'positive' && xs.tweet_count > 20) pts.push({ label: `Sentiment X positif (${xs.tweet_count} tweets, score ${xs.overall_score})`, score: 5 });

  // ── Dynamic: On-chain signals ──
  const oc = (s.metadata as any)?.onchain_signals;
  if (oc && oc.signal_score >= 70) pts.push({ label: `On-chain bullish (${oc.verdict}) — whale accumulation détectée`, score: 8 });
  if (oc?.dev_activity) pts.push({ label: 'Activité développeur élevée on-chain', score: 3 });

  // ── Dynamic: AI Defense clear ──
  const ad = (s.metadata as any)?.ai_defense;
  if (ad && ad.alert_count === 0) pts.push({ label: 'AI Defense: aucun signal de manipulation détecté', score: 5 });

  return pts;
}

function buildWhyNotPoints(s: Signal): { label: string; score?: number }[] {
  const trace = (s.metadata as any)?.decisionTrace;
  if (trace?.whyNot?.length) return trace.whyNot;
  const pts: { label: string; score?: number }[] = [];
  const mtf = s.metadata?.mtf_context ?? {};
  const pa = s.metadata?.price_action ?? {};
  const regime = s.metadata?.regime ?? {};
  const news = (s.metadata as any)?.news_sentiment;
  if (mtf.htf_aligned === false) pts.push({ label: `Désalignement HTF : ${mtf.htf_regime}` });
  if (regime.regime?.includes('VOLATILE')) pts.push({ label: 'Régime volatile — risque d\u2019extension brusque' });
  if (regime.adx !== undefined && regime.adx < 20) pts.push({ label: 'Tendance faible (ADX < 20)' });
  if (pa.structure?.includes('RANGE')) pts.push({ label: 'Prix en range — patience requise' });
  if (news?.bonus < 0) pts.push({ label: `Sentiment news négatif (${news.bonus} pts)` });
  if ((s.confidence ?? 0) < 55) pts.push({ label: 'Confiance globale faible (< 55%)' });

  // ── Dynamic: Token Grade low ──
  const tg = (s.metadata as any)?.token_grade;
  if (tg && tg.overall_grade < 40) pts.push({ label: `Token Grade faible (${tg.overall_grade}/100 — ${tg.grade_label})`, score: 8 });

  // ── Dynamic: X Sentiment negative ──
  const xs = (s.metadata as any)?.x_sentiment;
  if (xs && xs.overall_label === 'negative' && xs.tweet_count > 10) pts.push({ label: `Sentiment X négatif (${xs.tweet_count} tweets, score ${xs.overall_score})`, score: 5 });

  // ── Dynamic: On-chain bearish ──
  const oc = (s.metadata as any)?.onchain_signals;
  if (oc && oc.signal_score < 30) pts.push({ label: `On-chain bearish (${oc.verdict}) — distribution whale possible`, score: 6 });

  // ── Dynamic: AI Defense alerts ──
  const ad = (s.metadata as any)?.ai_defense;
  if (ad && ad.alert_count > 0) pts.push({ label: `AI Defense: ${ad.alert_count} alerte(s) — ${ad.recommendation}`, score: 10 });

  return pts;
}

function inferAssetType(symbol?: string): string {
  if (!symbol) return 'UNKNOWN';
  if (symbol.endsWith('/USDT')) return 'CRYPTO';
  if (symbol.startsWith('VIX') || symbol.startsWith('BOOM') || symbol.startsWith('CRASH') || symbol.startsWith('JUMP')) return 'SYNTHETIC';
  if (/^V\d+$/.test(symbol)) return 'SYNTHETIC';
  if (['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD', 'NZD/USD'].includes(symbol)) return 'FOREX';
  if (['XAU/USD', 'XAG/USD', 'WTI/USD', 'BRENT/USD'].includes(symbol)) return 'COMMODITY';
  return 'BRVM';
}

function fmtPrice(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const digits = n >= 1000 ? 0 : n >= 1 ? 2 : n >= 0.01 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ── Live Signal Tracker — real-time PnL + progress ──────────────────────────

function LiveSignalTracker({
  isBuy, livePrice, entry, sl, tp1, tp2, tp3, status,
}: {
  isBuy: boolean;
  livePrice: number;
  entry: number;
  sl: number;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  status?: string | null;
}) {
  const distToSl = Math.abs(livePrice - sl);
  const distToEntry = Math.abs(livePrice - entry);
  const totalRange = Math.abs(entry - sl);
  const progressPct = Math.max(0, Math.min(100, (distToEntry / totalRange) * 100));

  const nearestTp = [tp1, tp2, tp3].filter((t): t is number => t !== null).sort((a, b) =>
    Math.abs(livePrice - a) - Math.abs(livePrice - b)
  )[0];

  const distToNearestTp = nearestTp ? Math.abs(livePrice - nearestTp) : null;
  const tpProgress = nearestTp
    ? Math.max(0, Math.min(100, (1 - distToNearestTp! / Math.abs(nearestTp - sl)) * 100))
    : null;

  const pnlPct = isBuy
    ? ((livePrice - entry) / entry) * 100
    : ((entry - livePrice) / entry) * 100;

  const pnlPositive = pnlPct > 0;

  const hitSl = isBuy ? livePrice <= sl : livePrice >= sl;
  const hitTp1 = tp1 !== null && (isBuy ? livePrice >= tp1 : livePrice <= tp1);

  let liveStatus = 'EN COURS';
  let liveStatusColor = 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
  if (hitSl) {
    liveStatus = 'SL TOUCHÉ';
    liveStatusColor = 'text-red-400 bg-red-400/10 border-red-400/20';
  } else if (tp3 !== null && (isBuy ? livePrice >= tp3 : livePrice <= tp3)) {
    liveStatus = 'TP3 TOUCHÉ';
    liveStatusColor = 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
  } else if (tp2 !== null && (isBuy ? livePrice >= tp2 : livePrice <= tp2)) {
    liveStatus = 'TP2 TOUCHÉ';
    liveStatusColor = 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
  } else if (hitTp1) {
    liveStatus = 'TP1 TOUCHÉ';
    liveStatusColor = 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
  }

  return (
    <div className="mb-4 p-3 bg-gray-800/40 border border-gray-700/50 rounded-lg space-y-2">
      {/* PnL + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">PnL live</span>
          <span className={`text-sm font-mono font-bold ${pnlPositive ? 'text-emerald-400' : pnlPct < 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {pnlPositive ? '+' : ''}{pnlPct.toFixed(2)}%
          </span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${liveStatusColor}`}>
          {liveStatus}
        </span>
      </div>

      {/* Progress bar: SL ← Entry → TP */}
      <div className="relative h-6 bg-gray-900 rounded-full overflow-hidden">
        {/* SL zone (red) */}
        <div className="absolute left-0 top-0 h-full bg-red-500/20" style={{ width: '50%' }} />
        {/* TP zone (green) */}
        <div className="absolute right-0 top-0 h-full bg-emerald-500/20" style={{ width: '50%' }} />
        {/* Entry marker */}
        <div className="absolute top-0 h-full w-0.5 bg-gray-400" style={{ left: '50%' }} />
        {/* Live price indicator */}
        <div
          className="absolute top-0 h-full w-1 rounded-full transition-all duration-300"
          style={{
            left: `${progressPct}%`,
            backgroundColor: pnlPositive ? '#34d399' : '#f87171',
            boxShadow: `0 0 6px ${pnlPositive ? '#34d399' : '#f87171'}`,
          }}
        />
        {/* Labels */}
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-red-400/70 font-mono">SL</span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-emerald-400/70 font-mono">TP</span>
      </div>

      {/* Distance metrics */}
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>SL: <span className="font-mono text-red-400/80">{distToSl.toFixed(2)}</span> away</span>
        {nearestTp && (
          <span>TP: <span className="font-mono text-emerald-400/80">{distToNearestTp!.toFixed(2)}</span> away</span>
        )}
        {tpProgress !== null && (
          <span className="text-gray-400">{tpProgress.toFixed(0)}% vers TP</span>
        )}
      </div>
    </div>
  );
}

// ── Signal Timeline — key events history ─────────────────────────────────────

function SignalTimeline({ signal, livePrice }: { signal: Signal; livePrice: number | null }) {
  const events: { time: string; label: string; icon: React.ReactNode; color: string }[] = [];

  // 1. Signal created
  events.push({
    time: signal.createdAt ?? '—',
    label: `Signal ${signal.signal} g\u00e9n\u00e9r\u00e9 (confiance ${signal.confidence}%)`,
    icon: <CheckCircle2 className="w-3 h-3" />,
    color: 'text-emerald-400',
  });

  // 2. AI Defense alert
  const ad = (signal.metadata as any)?.ai_defense;
  if (ad && ad.alert_count > 0) {
    events.push({
      time: signal.createdAt ?? '—',
      label: `AI Defense: ${ad.alert_count} alerte(s) \u2014 ${ad.recommendation}`,
      icon: <ShieldAlert className="w-3 h-3" />,
      color: 'text-red-400',
    });
  }

  // 3. X Sentiment detected
  const xs = (signal.metadata as any)?.x_sentiment;
  if (xs) {
    events.push({
      time: signal.createdAt ?? '—',
      label: `Sentiment X: ${xs.overall_label} (${xs.tweet_count} tweets)`,
      icon: <Newspaper className="w-3 h-3" />,
      color: xs.overall_label === 'positive' ? 'text-emerald-400' : xs.overall_label === 'negative' ? 'text-red-400' : 'text-gray-400',
    });
  }

  // 4. On-chain signals
  const oc = (signal.metadata as any)?.onchain_signals;
  if (oc) {
    events.push({
      time: signal.createdAt ?? '—',
      label: `On-chain: ${oc.verdict} (score ${oc.signal_score})`,
      icon: <Activity className="w-3 h-3" />,
      color: oc.signal_score >= 70 ? 'text-emerald-400' : oc.signal_score >= 40 ? 'text-yellow-400' : 'text-red-400',
    });
  }

  // 5. Token Grade computed
  const tg = (signal.metadata as any)?.token_grade;
  if (tg) {
    events.push({
      time: signal.createdAt ?? '—',
      label: `Token Grade: ${tg.overall_grade}/100 (${tg.grade_label})`,
      icon: <Target className="w-3 h-3" />,
      color: tg.overall_grade >= 70 ? 'text-emerald-400' : tg.overall_grade >= 50 ? 'text-yellow-400' : 'text-red-400',
    });
  }

  // 6. Live price event
  if (livePrice !== null && signal.entryPrice) {
    const entry = parseFloat(signal.entryPrice);
    const pnlPct = signal.signal === 'BUY'
      ? ((livePrice - entry) / entry) * 100
      : ((entry - livePrice) / entry) * 100;
    const sl = signal.stopLoss ? parseFloat(signal.stopLoss) : null;
    const tp1 = signal.takeProfit1 ? parseFloat(signal.takeProfit1) : null;
    const isBuy = signal.signal === 'BUY';
    let label = `Prix live: $${livePrice.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;
    let color = pnlPct > 0 ? 'text-emerald-400' : pnlPct < 0 ? 'text-red-400' : 'text-gray-400';

    if (sl !== null && (isBuy ? livePrice <= sl : livePrice >= sl)) {
      label = `SL touch\u00e9 \u2014 prix $${livePrice.toFixed(2)}`;
      color = 'text-red-400';
    } else if (tp1 !== null && (isBuy ? livePrice >= tp1 : livePrice <= tp1)) {
      label = `TP1 touch\u00e9 \u2014 prix $${livePrice.toFixed(2)}`;
      color = 'text-emerald-400';
    }

    events.push({
      time: new Date().toISOString(),
      label,
      icon: <Clock className="w-3 h-3" />,
      color,
    });
  }

  return (
    <div className="space-y-2">
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <div className={`mt-0.5 ${ev.color}`}>{ev.icon}</div>
          <div className="flex-1">
            <span className="text-gray-300">{ev.label}</span>
            <span className="text-gray-600 ml-2 text-[10px]">
              {new Date(ev.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
