import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

const TF_TO_BARS_LOOKBACK: Record<string, number> = {
  '1m': 60, '5m': 48, '15m': 32, '1h': 24, '4h': 12, '1d': 5,
};

const TF_TO_BINANCE_INTERVAL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
};

@Injectable()
export class SignalOutcomeService {
  private readonly logger = new Logger(SignalOutcomeService.name);
  private engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async logSignal(r: any, market: string) {
    if (!r.signal || r.signal === 'NEUTRAL' || !r.entry_price) return;
    const indicators = r.indicators ?? {};
    try {
      await this.prisma.signalLog.create({
        data: {
          symbol:        r.symbol,
          timeframe:     r.timeframe,
          signalType:    r.signal as any,
          confidence:    r.confidence,
          entryPrice:    r.entry_price,
          stopLoss:      r.stop_loss      ?? null,
          takeProfit1:   r.take_profit_1  ?? null,
          takeProfit2:   r.take_profit_2  ?? null,
          riskReward:    r.risk_reward    ?? null,
          scoreTrend:    indicators.score_trend    ?? null,
          scorePA:       indicators.score_pa       ?? null,
          scoreSR:       indicators.score_sr       ?? null,
          scorePatterns: indicators.score_patterns ?? null,
          scoreRegime:   indicators.score_regime   ?? null,
          scoreSMC:      indicators.score_smc      ?? null,
          scoreMTF:      indicators.score_mtf      ?? null,
          scoreSentiment:indicators.score_sentiment?? null,
          scoreTotal:    indicators.score_total    ?? r.confidence,
          regime:        r.regime?.regime           ?? null,
          adx:           r.regime?.adx              ?? null,
          market,
        },
      });
    } catch (e: any) {
      this.logger.warn(`logSignal failed: ${e?.message}`);
    }
  }

  @Cron('0 * * * *')
  async resolveOutcomes() {
    this.logger.log('OUTCOME: vérification des signaux PENDING');

    const pending = await this.prisma.signalLog.findMany({
      where: { outcome: 'PENDING' },
      take: 200,
    });

    for (const log of pending) {
      try {
        await this._resolveOne(log);
      } catch (e: any) {
        this.logger.warn(`resolveOne failed ${log.symbol}: ${e?.message}`);
      }
    }

    this.logger.log(`OUTCOME: ${pending.length} signaux vérifiés`);
  }

  private async _resolveOne(log: any) {
    const tf = log.timeframe;
    const bars = TF_TO_BARS_LOOKBACK[tf] ?? 24;
    const interval = TF_TO_BINANCE_INTERVAL[tf] ?? '1h';

    const SYMBOL_MAP: Record<string, string> = {
      'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
      'BNB/USDT': 'BNBUSDT', 'AVAX/USDT': 'AVAXUSDT', 'ADA/USDT': 'ADAUSDT',
      'XRP/USDT': 'XRPUSDT', 'LINK/USDT': 'LINKUSDT', 'DOT/USDT': 'DOTUSDT',
      'MATIC/USDT': 'MATICUSDT',
    };
    const binanceSym = SYMBOL_MAP[log.symbol];
    if (!binanceSym) {
      // BRVM ou symbole non Binance — marquer EXPIRED après 5 jours
      const age = (Date.now() - new Date(log.createdAt).getTime()) / 86_400_000;
      if (age > 5) {
        await this.prisma.signalLog.update({
          where: { id: log.id },
          data: { outcome: 'EXPIRED', outcomeAt: new Date() },
        });
      }
      return;
    }

    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${bars}`;
    const { data } = await firstValueFrom(this.http.get(url));

    const entry   = parseFloat(log.entryPrice);
    const sl      = log.stopLoss    ? parseFloat(log.stopLoss)    : null;
    const tp1     = log.takeProfit1 ? parseFloat(log.takeProfit1) : null;
    const tp2     = log.takeProfit2 ? parseFloat(log.takeProfit2) : null;
    const isBuy   = log.signalType === 'BUY';
    const created = new Date(log.createdAt).getTime();

    let outcome: string | null = null;
    let outcomePrice: number | null = null;
    let barsToOutcome: number | null = null;
    let outcomeAt: Date | null = null;

    for (let i = 0; i < data.length; i++) {
      const bar = data[i];
      const barTs = parseInt(bar[0]);
      if (barTs < created) continue;

      const high = parseFloat(bar[2]);
      const low  = parseFloat(bar[3]);

      if (isBuy) {
        if (tp2 && high >= tp2) { outcome = 'WIN_TP2'; outcomePrice = tp2; }
        else if (tp1 && high >= tp1) { outcome = 'WIN_TP1'; outcomePrice = tp1; }
        else if (sl && low <= sl)    { outcome = 'LOSS_SL'; outcomePrice = sl; }
      } else {
        if (tp2 && low <= tp2)       { outcome = 'WIN_TP2'; outcomePrice = tp2; }
        else if (tp1 && low <= tp1)  { outcome = 'WIN_TP1'; outcomePrice = tp1; }
        else if (sl && high >= sl)   { outcome = 'LOSS_SL'; outcomePrice = sl; }
      }

      if (outcome) {
        barsToOutcome = i;
        outcomeAt = new Date(barTs);
        break;
      }
    }

    // Expiré si plus de N bougies sans résultat
    if (!outcome) {
      const age = (Date.now() - created) / 1000;
      const tfSecs: Record<string, number> = {
        '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
      };
      if (age > (tfSecs[tf] ?? 3600) * bars) {
        outcome = 'EXPIRED';
        outcomeAt = new Date();
      }
    }

    if (outcome) {
      await this.prisma.signalLog.update({
        where: { id: log.id },
        data: {
          outcome:       outcome as any,
          outcomePrice:  outcomePrice ?? undefined,
          outcomeAt:     outcomeAt ?? undefined,
          barsToOutcome: barsToOutcome ?? undefined,
        },
      });
    }
  }

  async getStats(market?: string) {
    const where: any = { outcome: { not: 'PENDING' } };
    if (market) where.market = market;

    const logs = await this.prisma.signalLog.findMany({ where, take: 2000 });

    const total  = logs.length;
    const winTp1 = logs.filter(l => l.outcome === 'WIN_TP1').length;
    const winTp2 = logs.filter(l => l.outcome === 'WIN_TP2').length;
    const lossSl = logs.filter(l => l.outcome === 'LOSS_SL').length;
    const expired= logs.filter(l => l.outcome === 'EXPIRED').length;

    return {
      total,
      win_tp1: winTp1,
      win_tp2: winTp2,
      loss_sl: lossSl,
      expired,
      win_rate_tp1: total > 0 ? Math.round((winTp1 + winTp2) / total * 100) : null,
      win_rate_tp2: total > 0 ? Math.round(winTp2 / total * 100) : null,
      by_market: market ? null : await this._statsByMarket(),
    };
  }

  private async _statsByMarket() {
    const markets = ['CRYPTO', 'FOREX', 'METALS', 'BRVM'];
    const result: Record<string, any> = {};
    for (const m of markets) {
      result[m] = await this.getStats(m);
      delete result[m].by_market;
    }
    return result;
  }
}
