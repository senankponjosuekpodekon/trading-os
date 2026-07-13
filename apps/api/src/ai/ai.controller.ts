import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const TF_TO_BINANCE_INTERVAL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
};
const SYM_TO_BINANCE: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
  'BNB/USDT': 'BNBUSDT', 'AVAX/USDT': 'AVAXUSDT', 'ADA/USDT': 'ADAUSDT',
  'XRP/USDT': 'XRPUSDT', 'LINK/USDT': 'LINKUSDT', 'DOT/USDT': 'DOTUSDT',
};

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private ai: AiService,
    private prisma: PrismaService,
    private http: HttpService,
  ) {}

  @Get('health')
  health() {
    return this.ai.health();
  }

  @Post('explain/signal/:signalId')
  async explainSignal(@Param('signalId') signalId: string) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { asset: true },
    });
    if (!signal) return { error: 'Signal not found' };

    const meta = (signal.metadata as any) ?? {};
    const payload = {
      symbol:       signal.asset.symbol,
      timeframe:    signal.timeframe,
      signal:       signal.signal,
      confidence:   parseFloat(signal.confidence.toString()),
      entry_price:  signal.entryPrice  ? parseFloat(signal.entryPrice.toString())  : null,
      stop_loss:    signal.stopLoss    ? parseFloat(signal.stopLoss.toString())    : null,
      take_profit_1: signal.takeProfit1 ? parseFloat(signal.takeProfit1.toString()) : null,
      take_profit_2: signal.takeProfit2 ? parseFloat(signal.takeProfit2.toString()) : null,
      risk_reward:  signal.riskReward ?? null,
      explanation:  signal.explanation ?? '',
      indicators:   (signal.indicators as any) ?? {},
      price_action: meta.price_action     ?? null,
      sr_zones:     meta.sr_zones         ?? null,
      patterns:     meta.patterns         ?? null,
      regime:       meta.regime           ?? null,
      smc:          meta.smc              ?? null,
      news_sentiment:    meta.news_sentiment    ?? null,
      scraper_sentiment: meta.scraper_sentiment ?? null,
      sentiment_pending: meta.sentiment_pending ?? false,
      language:     'fr',
    };

    return this.ai.explainSignal(payload);
  }

  @Post('explain')
  explainRaw(@Body() body: any) {
    return this.ai.explainSignal({ ...body, language: body.language ?? 'fr' });
  }

  @Post('weekly-report')
  weeklyReport(@Body() body: any) {
    return this.ai.weeklyReport(body);
  }

  @Post('review/position/:positionId')
  async reviewPosition(@Param('positionId') positionId: string) {
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      include: { asset: true, portfolio: true },
    });
    if (!position) return { error: 'Position not found' };

    const symbol   = position.asset.symbol;
    const binSym   = SYM_TO_BINANCE[symbol];
    const entry    = parseFloat(position.entryPrice.toString());
    const exit     = position.exitPrice ? parseFloat(position.exitPrice.toString()) : null;
    const qty      = parseFloat(position.quantity.toString());
    const pnl      = position.pnl ? parseFloat(position.pnl.toString()) : null;
    const pnlPct   = position.pnlPercent ? parseFloat(position.pnlPercent.toString()) : null;

    // Récupérer le signal lié si disponible
    let signalContext: any = null;
    if (position.signalId) {
      const sig = await this.prisma.signal.findUnique({
        where: { id: position.signalId },
        include: { asset: true, strategy: true },
      });
      if (sig) {
        const meta = (sig.metadata as any) ?? {};
        signalContext = {
          signal_type:       sig.signal,
          confidence:        parseFloat(sig.confidence.toString()),
          timeframe:         sig.timeframe,
          explanation:       sig.explanation ?? '',
          indicators:        (sig.indicators as any) ?? {},
          strategy:          sig.strategy?.name ?? null,
          regime:            meta.regime           ?? null,
          price_action:      meta.price_action     ?? null,
          sr_zones:          meta.sr_zones         ?? null,
          patterns:          meta.patterns         ?? null,
          smc:               meta.smc              ?? null,
          news_sentiment:    meta.news_sentiment   ?? null,
          scraper_sentiment: meta.scraper_sentiment ?? null,
          signal_created_at: sig.createdAt,
        };
      }
    }

    // Déduire le timeframe du signal ou fallback 1h
    const tf       = signalContext?.timeframe ?? '1h';
    const interval = TF_TO_BINANCE_INTERVAL[tf] ?? '1h';
    const TF_MS: Record<string, number> = {
      '1m': 60_000, '5m': 300_000, '15m': 900_000,
      '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
    };
    const tfMs = TF_MS[interval] ?? 3_600_000;

    let candles_before: any[] = [];
    let candles_during: any[] = [];

    if (binSym) {
      try {
        const openTs   = new Date(position.openedAt).getTime();
        const closeTs  = position.closedAt ? new Date(position.closedAt).getTime() : Date.now();
        // 5 bougies avant l'entrée (contexte pré-trade)
        const beforeStart = openTs - 5 * tfMs;
        const urlBefore = `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${interval}&startTime=${beforeStart}&endTime=${openTs}&limit=5`;
        // Bougies pendant le trade (de l'entrée jusqu'à la clôture, max 30)
        const urlDuring = `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${interval}&startTime=${openTs}&endTime=${closeTs + tfMs}&limit=30`;

        const [resBefore, resDuring] = await Promise.all([
          firstValueFrom(this.http.get<any[][]>(urlBefore)),
          firstValueFrom(this.http.get<any[][]>(urlDuring)),
        ]);

        const mapCandle = (k: any[]) => ({
          t:   new Date(k[0]).toISOString(),
          o:   parseFloat(k[1]),
          h:   parseFloat(k[2]),
          l:   parseFloat(k[3]),
          c:   parseFloat(k[4]),
          vol: parseFloat(k[5]),
        });
        candles_before = (resBefore.data as any[][]).map(mapCandle);
        candles_during = (resDuring.data as any[][]).map(mapCandle);
      } catch { /* actif non Binance */ }
    }

    // Calculs financiers
    const sl         = position.stopLoss   ? parseFloat(position.stopLoss.toString())   : null;
    const tp         = position.takeProfit ? parseFloat(position.takeProfit.toString()) : null;
    const cost       = parseFloat((entry * qty).toFixed(2));                          // argent immobilisé
    const maxGain    = tp   ? parseFloat((Math.abs(tp - entry)   * qty).toFixed(2)) : null; // gain si TP touché
    const maxLoss    = sl   ? parseFloat((Math.abs(entry - sl)   * qty).toFixed(2)) : null; // perte si SL touché
    const capital    = parseFloat(position.portfolio.currentCapital.toString());
    const roiIfTp    = tp && cost > 0 ? parseFloat(((maxGain! / cost) * 100).toFixed(2)) : null;
    const roiIfSl    = sl && cost > 0 ? parseFloat(((maxLoss! / cost) * 100).toFixed(2)) : null;
    const riskReward = sl && tp ? parseFloat((Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2)) : null;
    const capitalPct = cost > 0 && capital > 0 ? parseFloat(((cost / capital) * 100).toFixed(2)) : null;

    const payload = {
      symbol,
      timeframe:       tf,
      direction:       position.direction,
      status:          position.status,
      entry_price:     entry,
      exit_price:      exit,
      stop_loss:       sl,
      take_profit:     tp,
      quantity:        qty,
      cost,
      max_gain:        maxGain,
      max_loss:        maxLoss,
      roi_if_tp:       roiIfTp,
      roi_if_sl:       roiIfSl,
      risk_reward:     riskReward,
      capital_at_open: capital,
      capital_pct:     capitalPct,
      pnl,
      pnl_pct:         pnlPct,
      opened_at:       position.openedAt,
      closed_at:       position.closedAt ?? null,
      signal_context:  signalContext,
      candles_before,
      candles_during,
      language:        'fr',
    };

    return this.ai.reviewPosition(payload);
  }
}
