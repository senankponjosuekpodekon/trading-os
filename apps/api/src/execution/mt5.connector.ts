import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';
import { Mt5Contract, Mt5SizingError, unitsToLots, validateStops, riskToStop, marginRequired } from './mt5-sizing';

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

    if (params.type !== 'MARKET') {
      // Le bridge fait du TRADE_ACTION_DEAL (marché). Ordres LIMIT/STOP
      // pendants = TRADE_ACTION_PENDING — pas encore exposé par le bridge.
      throw new BadRequestException(
        `MT5: seuls les ordres MARKET sont supportés (type=${params.type}).`
      );
    }

    // 1. Specs broker réelles — fail-closed : pas de sizing sans contrat.
    const contract = await this._getContract(symbol);
    // 2. quantity = unités de base → lots (floor au volume_step, jamais plus)
    const volume = unitsToLots(params.quantity, contract);
    // 3. Tick courant : référence pour la distance SL/TP (stops_level)
    const quote = await this._getQuote(symbol);
    const referencePrice = params.side === 'BUY' ? quote.ask : quote.bid;
    const sl = params.stopPrice;
    const tp = params.takeProfit;
    validateStops(params.side, referencePrice, sl, tp, contract);
    // 4. Marge : seulement si le broker publie une marge fixe par lot ;
    //    mode flottant (forex) → on laisse le broker rejeter.
    const margin = marginRequired(volume, contract);
    if (margin !== null) {
      const account = await this._getAccount();
      if (margin > account.margin_free) {
        throw new BadRequestException(
          `MT5: marge insuffisante — requis ${margin} ${contract.currency_margin ?? ''}, ` +
          `disponible ${account.margin_free}`
        );
      }
    }

    const body: any = { symbol, side: params.side, volume };
    if (sl) body.sl = sl;
    if (tp) body.tp = tp;

    const sentAt = Date.now();
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
          lots: volume,
          riskToStop: riskToStop(volume, referencePrice, sl, contract),
          reconciled: false,
        },
      };
    } catch (err: any) {
      // Réponse incertaine (timeout, 5xx) : l'ordre a peut-être été
      // exécuté côté broker. Avant de remonter l'échec — et surtout avant
      // tout retry — on réconcilie via l'historique des deals récents.
      if (err instanceof BadRequestException) throw err;
      const reconciled = await this._reconcileFill(symbol, sentAt).catch(() => null);
      if (reconciled) {
        this.logger.warn(`MT5 order reconciled from deal history: ${reconciled.orderId}`);
        return reconciled;
      }
      this._rethrow(err, 'order');
    }
  }

  /** Après une réponse incertaine, cherche le deal correspondant dans
   *  l'historique récent (magic trading-os + symbole). Retourne null si
   *  rien ne prouve le fill — jamais de retry automatique aveugle. */
  private async _reconcileFill(symbol: string, sentAt: number): Promise<OrderResult | null> {
    const from = new Date(sentAt - 60_000).toISOString();
    const to = new Date(Date.now() + 1000).toISOString();
    const res = await axios.get(`${this.bridgeUrl}/history/deals`, {
      params: { from, to, limit: 50 },
      timeout: 10000,
      headers: this.headers,
    });
    const items = res.data?.items;
    if (!Array.isArray(items)) return null;
    const deal = items.find((d: any) =>
      d.symbol === symbol && d.magic === '20261118' &&
      typeof d.time_msc === 'number' && d.time_msc >= sentAt - 30_000);
    if (!deal) return null;
    return {
      orderId: String(deal.order ?? deal.ticket),
      symbol,
      side: deal.type === 0 ? 'BUY' : 'SELL',
      type: 'MARKET',
      status: 'FILLED',
      executedQty: String(deal.volume ?? 0),
      avgPrice: String(deal.price ?? 0),
      transactTime: deal.time_msc,
      exchange: ExchangeName.MT5,
      raw: { mt5_deal: deal.ticket, mt5_order: deal.order, reconciled: true },
    };
  }

  private async _getContract(symbol: string): Promise<Mt5Contract> {
    try {
      const res = await axios.get(`${this.bridgeUrl}/contract/${encodeURIComponent(symbol)}`, {
        timeout: 10000, headers: this.headers,
      });
      if (res.data?.error) {
        throw new BadRequestException(`MT5: contrat ${symbol} indisponible (${res.data.error})`);
      }
      return res.data as Mt5Contract;
    } catch (err: any) {
      this._rethrow(err, 'contract');
    }
  }

  private async _getQuote(symbol: string): Promise<{ bid: number; ask: number }> {
    try {
      const res = await axios.get(`${this.bridgeUrl}/quote/${encodeURIComponent(symbol)}`, {
        timeout: 10000, headers: this.headers,
      });
      const d = res.data;
      if (d.error || !(d.bid > 0) || !(d.ask > 0)) {
        throw new ServiceUnavailableException(`MT5: pas de cotation live pour ${symbol}`);
      }
      return { bid: d.bid, ask: d.ask };
    } catch (err: any) {
      this._rethrow(err, 'quote');
    }
  }

  private async _getAccount(): Promise<{ margin_free: number }> {
    try {
      const res = await axios.get(`${this.bridgeUrl}/account`, {
        timeout: 10000, headers: this.headers,
      });
      if (res.data?.error) {
        throw new ServiceUnavailableException(`MT5: compte indisponible (${res.data.error})`);
      }
      return { margin_free: Number(res.data.margin_free) || 0 };
    } catch (err: any) {
      this._rethrow(err, 'account');
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

  /**
   * Gestion directe des positions MT5 (compte partagé du bridge).
   * Le magic 20261118 est TOUJOURS transmis — /close et /modify refusent
   * de toucher des positions qui ne viennent pas de trading-os.
   */
  async getTickerPrice(_login: string, _password: string, appSymbol: string): Promise<number | null> {
    const res = await axios.get(
      `${this.bridgeUrl}/quote/${encodeURIComponent(this.mapSymbol(appSymbol))}`,
      { headers: this.headers, timeout: 15000 },
    ).catch(() => null);
    const d = (res as any)?.data;
    if (d?.bid && d?.ask) return (d.bid + d.ask) / 2;
    return null;
  }

  async getPositions(): Promise<any[]> {
    const res = await axios.get(`${this.bridgeUrl}/positions`, {
      headers: this.headers, timeout: 15000,
    }).catch(err => { this._rethrow(err, 'positions'); });
    const d = (res as any).data;
    return Array.isArray(d) ? d : (d?.positions ?? []);
  }

  async closeSymbol(appSymbol: string): Promise<{ closed: any[]; errors: any[] }> {
    const res = await axios.post(`${this.bridgeUrl}/close`, {
      symbol: this.mapSymbol(appSymbol), magic: 20261118,
    }, { headers: this.headers, timeout: 20000 })
      .catch(err => { this._rethrow(err, 'close'); });
    return (res as any).data;
  }

  async closeAll(): Promise<any> {
    const res = await axios.post(`${this.bridgeUrl}/close-all`, {}, {
      headers: this.headers, timeout: 30000,
    }).catch(err => { this._rethrow(err, 'close-all'); });
    return (res as any).data;
  }

  async modifyStops(appSymbol: string, sl?: number, tp?: number): Promise<any> {
    if (sl == null && tp == null) {
      throw new BadRequestException('MT5: sl ou tp requis pour modify.');
    }
    const res = await axios.post(`${this.bridgeUrl}/modify`, {
      symbol: this.mapSymbol(appSymbol), magic: 20261118,
      ...(sl != null && { sl }), ...(tp != null && { tp }),
    }, { headers: this.headers, timeout: 20000 })
      .catch(err => { this._rethrow(err, 'modify'); });
    return (res as any).data;
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
    if (err instanceof Mt5SizingError) {
      throw new BadRequestException(`MT5 sizing: ${err.message}`);
    }
    throw new BadRequestException(`MT5 ${op} failed: ${msg}`);
  }

  mapSymbol(symbol: string): string {
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
      'NAS100': 'US Tech 100',
      'US30': 'US30',
      'GER30': 'Germany 40',
      'UK100': 'UK 100',
      // Indices synthétiques Deriv (noms terminal Deriv-Demo)
      'V10': 'Volatility 10 Index',
      'V25': 'Volatility 25 Index',
      'V50': 'Volatility 50 Index',
      'V75': 'Volatility 75 Index',
      'V100': 'Volatility 100 Index',
      'BOOM300': 'Boom 300 Index',
      'BOOM500': 'Boom 500 Index',
      'BOOM1000': 'Boom 1000 Index',
      'CRASH300': 'Crash 300 Index',
      'CRASH500': 'Crash 500 Index',
      'CRASH1000': 'Crash 1000 Index',
      'JUMP10': 'Jump 10 Index',
      'JUMP25': 'Jump 25 Index',
      'JUMP50': 'Jump 50 Index',
      'JUMP75': 'Jump 75 Index',
      'JUMP100': 'Jump 100 Index',
      // Crypto Deriv (sans slash) — DOGE/LINK/AVAX indisponibles sur Deriv
      'BTC/USDT': 'BTCUSD',
      'ETH/USDT': 'ETHUSD',
      'SOL/USDT': 'SOLUSD',
      'XRP/USDT': 'XRPUSD',
      'ADA/USDT': 'ADAUSD',
      'BNB/USDT': 'BNBUSD',
      'LTC/USDT': 'LTCUSD',
      'DOT/USDT': 'DOTUSD',
      'BTC/USD': 'BTCUSD',
      'ETH/USD': 'ETHUSD',
      'SOL/USD': 'SOLUSD',
      'XRP/USD': 'XRPUSD',
      'ADA/USD': 'ADAUSD',
      'BNB/USD': 'BNBUSD',
      'LTC/USD': 'LTCUSD',
      'DOT/USD': 'DOTUSD',
      // Indices boursiers Deriv (noms complets — US30/US500 absents)
      'FRA40': 'France 40',
      'JPN225': 'Japan 225',
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
}
