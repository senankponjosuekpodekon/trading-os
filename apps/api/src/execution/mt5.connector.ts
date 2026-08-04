import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

/**
 * MT5 Connector — communicates with a Python MT5 bridge microservice.
 *
 * Architecture:
 *   NestJS (this connector) → HTTP → Python MT5 bridge (MetaTrader5 lib) → MT5 terminal
 *
 * The Python bridge must be running on a VPS with MT5 terminal installed.
 * It exposes REST endpoints that proxy requests to the MetaTrader5 Python library.
 *
 * Credentials mapping:
 *   apiKey    = MT5 login (account number)
 *   apiSecret = MT5 password
 *   The bridge URL is configured via MT5_BRIDGE_URL env var.
 *
 * Supported brokers (any MT5 broker): Exness, IC Markets, Pepperstone, FBS, RoboForex, Alpari, etc.
 */
@Injectable()
export class Mt5Connector implements ExchangeConnector {
  readonly exchange = ExchangeName.MT5;
  private readonly logger = new Logger(Mt5Connector.name);
  private readonly bridgeUrl: string;

  constructor(private config: ConfigService) {
    this.bridgeUrl = this.config.get<string>('MT5_BRIDGE_URL') || 'http://localhost:8001';
  }

  async placeOrder(login: string, password: string, params: OrderParams): Promise<OrderResult> {
    if (!login || !password) {
      throw new BadRequestException('MT5: login et mot de passe requis.');
    }

    const symbol = this.mapSymbol(params.symbol);
    const volume = this.normalizeVolume(params.quantity);
    const direction = params.side === 'BUY' ? 'BUY' : 'SELL';

    const body: any = {
      login: String(login),
      password,
      symbol,
      volume,
      direction,
      order_type: params.type === 'LIMIT' ? 'ORDER_TYPE_BUY_LIMIT' : 'ORDER_TYPE_MARKET',
    };

    if (params.price && params.type === 'LIMIT') {
      body.price = params.price;
    }
    if (params.stopPrice) {
      body.sl = params.stopPrice;
    }

    try {
      const res = await axios.post(`${this.bridgeUrl}/mt5/order`, body, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      });

      const d = res.data;
      if (d.error) {
        throw new BadRequestException(`MT5: ${d.error}`);
      }

      const ticket = d.ticket || d.order_id || `mt5-${Date.now()}`;
      const fillPrice = d.price || params.price || 0;
      const fillVolume = d.volume || volume;

      return {
        orderId: String(ticket),
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: d.status === 'FILLED' ? 'FILLED' : 'PENDING',
        executedQty: String(fillVolume),
        avgPrice: String(fillPrice),
        transactTime: d.timestamp || Date.now(),
        exchange: ExchangeName.MT5,
        raw: {
          mt5_ticket: ticket,
          mt5_symbol: symbol,
          mt5_login: String(login),
          broker: d.broker || 'unknown',
        },
      };
    } catch (err: any) {
      const dErr = err?.response?.data;
      const msg = dErr?.error || dErr?.message || err?.message || 'Unknown MT5 error';

      if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
        throw new ServiceUnavailableException(
          'MT5 bridge timeout — vérifiez que le bridge Python est démarré et que MT5 Terminal est en cours d\'exécution.'
        );
      }
      if (err?.code === 'ECONNREFUSED') {
        throw new ServiceUnavailableException(
          'MT5 bridge inaccessible — démarrez le microservice Python (mt5_bridge.py).'
        );
      }
      if (err?.response?.status === 401) {
        throw new BadRequestException('MT5: login ou mot de passe invalide.');
      }
      if (err?.response?.status === 400) {
        throw new BadRequestException(`MT5: ${msg}`);
      }
      throw new BadRequestException(`MT5 order failed: ${msg}`);
    }
  }

  async getAccountBalance(login: string, password: string): Promise<BalanceResult[]> {
    if (!login || !password) {
      throw new BadRequestException('MT5: login et mot de passe requis.');
    }

    try {
      const res = await axios.post(
        `${this.bridgeUrl}/mt5/balance`,
        { login: String(login), password },
        { timeout: 10000 },
      );

      const d = res.data;
      if (d.error) {
        throw new BadRequestException(`MT5: ${d.error}`);
      }

      return [{
        asset: d.currency || 'USD',
        free: String(d.balance ?? 0),
        locked: String(d.equity ? (d.balance - d.equity) : 0),
      }];
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Unknown error';
      this.logger.error(`MT5 balance failed: ${msg}`);

      if (err?.code === 'ECONNREFUSED') {
        throw new ServiceUnavailableException('MT5 bridge inaccessible.');
      }
      throw new BadRequestException(`MT5 balance: ${msg}`);
    }
  }

  async validateCredentials(login: string, password: string): Promise<boolean> {
    try {
      const res = await axios.post(
        `${this.bridgeUrl}/mt5/validate`,
        { login: String(login), password },
        { timeout: 10000 },
      );
      return res.data?.valid === true;
    } catch {
      return false;
    }
  }

  private mapSymbol(symbol: string): string {
    const mapping: Record<string, string> = {
      'EUR/USD': 'EURUSD',
      'GBP/USD': 'GBPUSD',
      'USD/JPY': 'USDJPY',
      'USD/CHF': 'USDCHF',
      'AUD/USD': 'AUDUSD',
      'USD/CAD': 'USDCAD',
      'NZD/USD': 'NZDUSD',
      'EUR/GBP': 'EURGBP',
      'EUR/JPY': 'EURJPY',
      'EUR/CHF': 'EURCHF',
      'GBP/JPY': 'GBPJPY',
      'GBP/CHF': 'GBPCHF',
      'AUD/JPY': 'AUDJPY',
      'AUD/NZD': 'AUDNZD',
      'CAD/JPY': 'CADJPY',
      'CHF/JPY': 'CHFJPY',
      'NZD/JPY': 'NZDJPY',
      'XAU/USD': 'XAUUSD',
      'XAG/USD': 'XAGUSD',
      'WTI/USD': 'WTIUSD',
      'BRENT/USD': 'BRENTUSD',
      'SPX500': 'SPX500',
      'NAS100': 'NAS100',
      'US30': 'US30',
      'GER30': 'GER30',
      'UK100': 'UK100',
      'JP225': 'JP225',
    };

    const mapped = mapping[symbol];
    if (!mapped) {
      if (/^[A-Z]{6}$/.test(symbol)) {
        return symbol;
      }
      throw new BadRequestException(
        `MT5: symbole "${symbol}" non supporté. Exemples: ${Object.keys(mapping).slice(0, 8).join(', ')}...`
      );
    }
    return mapped;
  }

  private normalizeVolume(quantity: number): number {
    // MT5 uses lots — typical minimum is 0.01 lot
    // If quantity looks like units (e.g. 10000), convert to lots
    if (quantity >= 1000) {
      return Math.round((quantity / 100000) * 100) / 100;
    }
    return Math.max(0.01, Math.round(quantity * 100) / 100);
  }
}
