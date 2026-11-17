import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

/**
 * MT5 Connector — dialogue avec le bridge Wine tools/mt5-bridge/server.py.
 *
 * Architecture:
 *   NestJS (this connector) → HTTP+Bearer → bridge (:5555) → terminal MT5 (Wine)
 *
 * Le bridge gère UN SEUL compte broker (MT5_LOGIN/PASSWORD/SERVER dans
 * /etc/mt5-bridge.env sur le VPS). Les paramètres apiKey/apiSecret de
 * l'interface ExchangeConnector sont donc ignorés — la connexion
 * "exchange" enregistrée par l'utilisateur pointe vers ce compte partagé.
 *
 * Env : MT5_BRIDGE_URL + MT5_BRIDGE_TOKEN (partagés avec l'engine).
 */
@Injectable()
export class Mt5Connector implements ExchangeConnector {
  readonly exchange = ExchangeName.MT5;
  private readonly logger = new Logger(Mt5Connector.name);
  private readonly bridgeUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private config: ConfigService) {
    this.bridgeUrl =
      this.config.get<string>('MT5_BRIDGE_URL') || 'http://localhost:5555';
    const token = this.config.get<string>('MT5_BRIDGE_TOKEN') || '';
    this.headers = { Authorization: `Bearer ${token}` };
  }

  async placeOrder(_login: string, _password: string, params: OrderParams): Promise<OrderResult> {
    const symbol = this.mapSymbol(params.symbol);
    const volume = this.normalizeVolume(params.quantity);

    if (params.type !== 'MARKET') {
      // Le bridge fait du TRADE_ACTION_DEAL (marché). Ordres LIMIT/STOP
      // pendants = TRADE_ACTION_PENDING — pas encore exposé par le bridge.
      throw new BadRequestException(
        `MT5: seuls les ordres MARKET sont supportés (type=${params.type}).`
      );
    }

    const body: any = { symbol, side: params.side, volume };
    if (params.stopPrice) body.sl = params.stopPrice;

    try {
      const res = await axios.post(`${this.bridgeUrl}/order`, body, {
        timeout: 20000,
        headers: this.headers,
      });

      const d = res.data;
      if (d.error) {
        throw new BadRequestException(`MT5: ${d.error}`);
      }

      const ticket = d.order || d.deal || `mt5-${Date.now()}`;
      return {
        orderId: String(ticket),
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: 'FILLED',
        executedQty: String(d.volume ?? volume),
        avgPrice: String(d.price ?? 0),
        transactTime: Date.now(),
        exchange: ExchangeName.MT5,
        raw: {
          mt5_order: d.order,
          mt5_deal: d.deal,
          mt5_symbol: symbol,
        },
      };
    } catch (err: any) {
      this._rethrow(err, 'order');
    }
  }

  async getAccountBalance(_login: string, _password: string): Promise<BalanceResult[]> {
    try {
      const res = await axios.get(`${this.bridgeUrl}/account`, {
        timeout: 10000,
        headers: this.headers,
      });
      const d = res.data;
      if (d.error) {
        throw new BadRequestException(`MT5: ${d.error}`);
      }
      return [{
        asset: d.currency || 'USD',
        free: String(d.margin_free ?? d.balance ?? 0),
        locked: String(d.margin ?? 0),
      }];
    } catch (err: any) {
      this._rethrow(err, 'balance');
    }
  }

  async validateCredentials(_login: string, _password: string): Promise<boolean> {
    // Le "credential" réel est le compte configuré côté bridge : on valide
    // que le bridge répond ET que le terminal est connecté au broker.
    try {
      const res = await axios.get(`${this.bridgeUrl}/health`, {
        timeout: 30000, // _ensure() peut relancer le terminal (~1-2 min)
        headers: this.headers,
      });
      return res.data?.connected === true;
    } catch {
      return false;
    }
  }

  private _rethrow(err: any, op: string): never {
    const status = err?.response?.status;
    const msg = err?.response?.data?.error || err?.message || 'Unknown MT5 error';

    if (err instanceof BadRequestException) throw err;
    if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
      throw new ServiceUnavailableException(
        'MT5 bridge timeout — vérifiez tools/mt5-bridge (systemctl status mt5-bridge).'
      );
    }
    if (err?.code === 'ECONNREFUSED') {
      throw new ServiceUnavailableException(
        'MT5 bridge inaccessible — service mt5-bridge arrêté sur le VPS.'
      );
    }
    if (status === 401) {
      this.logger.error(`MT5 bridge 401 — MT5_BRIDGE_TOKEN incorrect`);
      throw new ServiceUnavailableException('MT5 bridge: token invalide.');
    }
    if (status === 503) {
      throw new ServiceUnavailableException(
        'Terminal MT5 non connecté au broker (mt5_disconnected).'
      );
    }
    throw new BadRequestException(`MT5 ${op} failed: ${msg}`);
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
