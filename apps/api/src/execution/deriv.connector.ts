import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import WebSocket from 'ws';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

/**
 * Connecteur Deriv — nouvelle API Options (api.derivws.com).
 *
 * Flux d'auth : POST /trading/v1/options/accounts/{accountId}/otp
 *   headers: Deriv-App-ID + Bearer <token>
 *   → data.url = wss://api.derivws.com/trading/v1/options/ws/{demo|real}?otp=…
 * Ensuite : proposal (underlying_symbol) → buy(proposal_id) sur la même session.
 *
 * Convention credentials (exchange_connections) :
 *   apiKey    = Bearer token Deriv (PAT/OAuth, scope "trade")
 *   apiSecret = Deriv Options account ID (ex. DOT90004580, VRTC…, CR…)
 * Env : DERIV_APP_ID = ID de l'application enregistrée sur developers.deriv.com
 */
@Injectable()
export class DerivConnector implements ExchangeConnector {
  readonly exchange = ExchangeName.DERIV;
  private readonly logger = new Logger(DerivConnector.name);
  private readonly apiBase = 'https://api.derivws.com';
  private readonly appId: string;

  constructor(private config: ConfigService) {
    this.appId = this.config.get<string>('DERIV_APP_ID', '');
  }

  private async getTradingWsUrl(bearerToken: string, accountId: string): Promise<string> {
    if (!this.appId) {
      throw new BadRequestException('Deriv: DERIV_APP_ID non configuré côté serveur');
    }
    const res = await axios.post(
      `${this.apiBase}/trading/v1/options/accounts/${accountId}/otp`,
      {},
      {
        headers: {
          'Deriv-App-ID': this.appId,
          Authorization: `Bearer ${bearerToken}`,
        },
        timeout: 10000,
      },
    );
    const url = res.data?.data?.url;
    if (!url) {
      throw new BadRequestException('Deriv: pas d’URL WebSocket retournée par l’OTP');
    }
    return url;
  }

  /** Ouvre une session WS scopée compte (OTP dans l'URL) et exécute `fn`. */
  private async withTradingWs<T>(bearerToken: string, accountId: string, fn: (ws: WebSocket) => Promise<T>): Promise<T> {
    const wsUrl = await this.getTradingWsUrl(bearerToken, accountId);
    const ws = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', (e) => reject(e));
        setTimeout(() => reject(new Error('Deriv WS open timeout')), 10000);
      });
      return await fn(ws);
    } finally {
      try { ws.close(); } catch { /* noop */ }
    }
  }

  private wsRoundtrip(ws: WebSocket, payload: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deriv WS response timeout')), timeoutMs);
      ws.once('message', (raw) => {
        clearTimeout(timer);
        try { resolve(JSON.parse(raw.toString())); }
        catch (e) { reject(e); }
      });
      ws.send(JSON.stringify(payload));
    });
  }

  async placeOrder(apiKey: string, apiSecret: string, params: OrderParams): Promise<OrderResult> {
    const symbol = this.mapSymbol(params.symbol);
    const stake = params.quantity;

    try {
      return await this.withTradingWs(apiKey, apiSecret, async (ws) => {
        const prop = await this.wsRoundtrip(ws, {
          proposal: 1,
          amount: stake,
          basis: 'stake',
          contract_type: params.side === 'BUY' ? 'CALL' : 'PUT',
          currency: 'USD',
          duration: 5,
          duration_unit: 'm',
          underlying_symbol: symbol,
        });
        if (prop.error) {
          throw new BadRequestException(`Deriv proposal: ${prop.error.message}`);
        }
        const proposalId = prop.proposal?.id;
        if (!proposalId) {
          throw new BadRequestException('Deriv: no proposal ID returned');
        }

        const buy = await this.wsRoundtrip(ws, { buy: proposalId, price: stake });
        if (buy.error) {
          throw new BadRequestException(`Deriv buy: ${buy.error.message}`);
        }

        const contract = buy.buy;
        return {
          orderId: String(contract.contract_id),
          symbol: params.symbol,
          side: params.side,
          type: params.type,
          status: 'OPEN',
          executedQty: String(stake),
          avgPrice: String(contract.buy_price),
          transactTime: Date.now(),
          exchange: ExchangeName.DERIV,
          raw: buy,
        };
      });
    } catch (err: any) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      const msg = err?.response?.data?.message || err?.message || 'Unknown Deriv error';
      if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED') {
        throw new ServiceUnavailableException('Deriv API timeout — retry later');
      }
      if (err?.response?.status === 429) {
        throw new ServiceUnavailableException('Deriv rate limit exceeded');
      }
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        throw new BadRequestException('Deriv auth failed — vérifiez Bearer token / account ID');
      }
      throw new BadRequestException(`Deriv order failed: ${msg}`);
    }
  }

  async getAccountBalance(apiKey: string, apiSecret: string): Promise<BalanceResult[]> {
    try {
      return await this.withTradingWs(apiKey, apiSecret, async (ws) => {
        const res = await this.wsRoundtrip(ws, { balance: 1 });
        if (res.error) {
          throw new BadRequestException(`Deriv balance: ${res.error.message}`);
        }
        const balance = res.balance;
        if (!balance) {
          throw new BadRequestException('Deriv: no balance returned');
        }
        return [{
          asset: balance.currency || 'USD',
          free: String(balance.balance),
          locked: '0',
        }];
      });
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      const msg = err?.response?.data?.message || err?.message || 'Unknown error';
      this.logger.error(`Deriv balance failed: ${msg}`);
      throw new BadRequestException(`Deriv balance: ${msg}`);
    }
  }

  async validateCredentials(apiKey: string, apiSecret: string): Promise<boolean> {
    try {
      // Un OTP valide prouve Bearer token + account ID + app ID
      await this.getTradingWsUrl(apiKey, apiSecret);
      return true;
    } catch {
      return false;
    }
  }

  private mapSymbol(symbol: string): string {
    const mapping: Record<string, string> = {
      'V10': 'R_10',
      'V25': 'R_25',
      'V50': 'R_50',
      'V75': 'R_75',
      'V100': 'R_100',
      'VIX10/USD': 'R_10',
      'VIX25/USD': 'R_25',
      'VIX50/USD': 'R_50',
      'VIX75/USD': 'R_75',
      'VIX100/USD': 'R_100',
      'BOOM300': 'BOOM300N',
      'BOOM500': 'BOOM500',
      'BOOM1000': 'BOOM1000',
      'CRASH300': 'CRASH300N',
      'CRASH500': 'CRASH500',
      'CRASH1000': 'CRASH1000',
      'JUMP10': 'JD10',
      'JUMP25': 'JD25',
      'JUMP50': 'JD50',
      'JUMP75': 'JD75',
      'JUMP100': 'JD100',
      'EUR/USD': 'frxEURUSD',
      'GBP/USD': 'frxGBPUSD',
      'USD/JPY': 'frxUSDJPY',
      'AUD/USD': 'frxAUDUSD',
      'XAU/USD': 'frxXAUUSD',
      'XAG/USD': 'frxXAGUSD',
      'WTI/USD': 'crude',
    };

    const mapped = mapping[symbol];
    if (!mapped) {
      throw new BadRequestException(`Deriv: unsupported symbol "${symbol}". Supported: ${Object.keys(mapping).join(', ')}`);
    }
    return mapped;
  }
}
