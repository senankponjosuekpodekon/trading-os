import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

@Injectable()
export class OandaConnector implements ExchangeConnector {
  readonly exchange = ExchangeName.OANDA;
  private readonly logger = new Logger(OandaConnector.name);
  private readonly baseUrl: string;

  constructor(private config: ConfigService) {
    const isPractice = this.config.get<string>('OANDA_USE_PRACTICE') === 'true';
    this.baseUrl = isPractice
      ? 'https://api-fxpractice.oanda.com'
      : 'https://api-fxtrade.oanda.com';
  }

  async placeOrder(apiKey: string, accountId: string, params: OrderParams): Promise<OrderResult> {
    if (!accountId || accountId.trim().length < 3) {
      throw new BadRequestException('OANDA: Account ID requis (stocké dans le champ API Secret).');
    }

    const instrument = this.mapSymbol(params.symbol);
    const units = this.calculateUnits(params.side, params.quantity);

    const orderBody: any = {
      order: {
        type: params.type === 'LIMIT' ? 'LIMIT' : 'MARKET',
        instrument,
        units,
        timeInForce: params.type === 'LIMIT' ? 'GTD' : 'FOK',
      },
    };

    if (params.price && params.type === 'LIMIT') {
      orderBody.order.price = String(params.price);
    }

    if (params.stopPrice) {
      orderBody.order.stopLossOnFill = {
        price: String(params.stopPrice),
      };
    }

    try {
      const res = await axios.post(
        `${this.baseUrl}/v3/accounts/${accountId}/orders`,
        orderBody,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );

      const d = res.data;
      const orderFill = d.orderFillTransaction || d.orderCreateTransaction;

      if (!orderFill) {
        throw new BadRequestException('OANDA: aucune transaction retournée.');
      }

      const orderId = orderFill.orderID || orderFill.id || `oanda-${Date.now()}`;
      const filledQty = orderFill.units ? Math.abs(parseFloat(orderFill.units)) : params.quantity;
      const fillPrice = orderFill.price ? parseFloat(orderFill.price) : (params.price || 0);

      return {
        orderId: String(orderId),
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: orderFill.type === 'ORDER_FILL' ? 'FILLED' : 'PENDING',
        executedQty: String(filledQty),
        avgPrice: String(fillPrice),
        transactTime: Date.now(),
        exchange: ExchangeName.OANDA,
        raw: {
          accountID: accountId,
          instrument,
          units: orderFill.units,
          oandaOrderId: orderId,
        },
      };
    } catch (err: any) {
      const dErr = err?.response?.data;
      const msg = dErr?.errorMessage || dErr?.message || err?.message || 'Unknown OANDA error';

      if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
        throw new ServiceUnavailableException('OANDA API timeout — réessayez plus tard.');
      }
      if (err?.response?.status === 429) {
        throw new ServiceUnavailableException('OANDA rate limit exceeded.');
      }
      if (err?.response?.status === 400) {
        throw new BadRequestException(`OANDA: ${msg}`);
      }
      if (err?.response?.status === 401) {
        throw new BadRequestException('OANDA: token API invalide ou expiré.');
      }
      if (err?.response?.status === 403) {
        throw new BadRequestException('OANDA: accès refusé — vérifiez votre compte et permissions.');
      }
      throw new BadRequestException(`OANDA order failed: ${msg}`);
    }
  }

  async getAccountBalance(apiKey: string, accountId: string): Promise<BalanceResult[]> {
    if (!accountId || accountId.trim().length < 3) {
      throw new BadRequestException('OANDA: Account ID requis.');
    }

    try {
      const res = await axios.get(
        `${this.baseUrl}/v3/accounts/${accountId}/summary`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        },
      );

      const account = res.data?.account;
      if (!account) {
        throw new BadRequestException('OANDA: compte introuvable.');
      }

      const balances: BalanceResult[] = [{
        asset: account.currency || 'USD',
        free: String(account.balance),
        locked: String(
          parseFloat(account.balance) - parseFloat(account.NAV || account.balance)
        ),
      }];

      return balances;
    } catch (err: any) {
      const msg = err?.response?.data?.errorMessage || err?.message || 'Unknown error';
      this.logger.error(`OANDA balance failed: ${msg}`);
      if (err?.response?.status === 401) {
        throw new BadRequestException('OANDA: token API invalide.');
      }
      throw new BadRequestException(`OANDA balance: ${msg}`);
    }
  }

  async validateCredentials(apiKey: string, accountId: string): Promise<boolean> {
    try {
      if (!accountId || accountId.trim().length < 3) {
        return false;
      }

      const res = await axios.get(
        `${this.baseUrl}/v3/accounts/${accountId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        },
      );

      return res.data?.account?.id === accountId;
    } catch {
      return false;
    }
  }

  private mapSymbol(symbol: string): string {
    const mapping: Record<string, string> = {
      'EUR/USD': 'EUR_USD',
      'GBP/USD': 'GBP_USD',
      'USD/JPY': 'USD_JPY',
      'USD/CHF': 'USD_CHF',
      'AUD/USD': 'AUD_USD',
      'USD/CAD': 'USD_CAD',
      'NZD/USD': 'NZD_USD',
      'EUR/GBP': 'EUR_GBP',
      'EUR/JPY': 'EUR_JPY',
      'EUR/CHF': 'EUR_CHF',
      'GBP/JPY': 'GBP_JPY',
      'GBP/CHF': 'GBP_CHF',
      'AUD/JPY': 'AUD_JPY',
      'AUD/NZD': 'AUD_NZD',
      'CAD/JPY': 'CAD_JPY',
      'CHF/JPY': 'CHF_JPY',
      'NZD/JPY': 'NZD_JPY',
      'XAU/USD': 'XAU_USD',
      'XAG/USD': 'XAG_USD',
      'WTI/USD': 'WTI_USD',
      'BRENT/USD': 'BRENT_USD',
      'SPX500': 'SPX500_USD',
      'NAS100': 'NAS100_USD',
      'US30': 'US30_USD',
      'GER30': 'GER30_EUR',
      'UK100': 'UK100_GBP',
      'JP225': 'JP225_USD',
    };

    const mapped = mapping[symbol];
    if (!mapped) {
      if (/^[A-Z]{3}_[A-Z]{3}$/.test(symbol)) {
        return symbol;
      }
      throw new BadRequestException(
        `OANDA: symbole "${symbol}" non supporté. Exemples: ${Object.keys(mapping).slice(0, 8).join(', ')}...`
      );
    }
    return mapped;
  }

  private calculateUnits(side: string, quantity: number): string {
    const units = side === 'BUY' ? Math.abs(quantity) : -Math.abs(quantity);
    return String(units);
  }
}
