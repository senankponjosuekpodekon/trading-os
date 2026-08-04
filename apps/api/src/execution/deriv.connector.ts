import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

@Injectable()
export class DerivConnector implements ExchangeConnector {
  readonly exchange = ExchangeName.DERIV;
  private readonly logger = new Logger(DerivConnector.name);
  private readonly apiUrl: string;

  constructor(private config: ConfigService) {
    this.apiUrl = 'https://api.deriv.com';
  }

  async placeOrder(apiKey: string, _apiSecret: string, params: OrderParams): Promise<OrderResult> {
    const symbol = this.mapSymbol(params.symbol);
    const stake = params.quantity;

    try {
      const proposalRes = await axios.post(`${this.apiUrl}/proposal`, {
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: params.side === 'BUY' ? 'CALL' : 'PUT',
        currency: 'USD',
        duration: 5,
        duration_unit: 'm',
        symbol,
      }, {
        headers: { Authorization: apiKey },
        timeout: 10000,
      });

      const proposalId = proposalRes.data?.proposal?.id;
      if (!proposalId) {
        throw new BadRequestException('Deriv: no proposal ID returned');
      }

      const buyRes = await axios.post(`${this.apiUrl}/buy`, {
        buy: proposalId,
        price: stake,
      }, {
        headers: { Authorization: apiKey },
        timeout: 10000,
      });

      const d = buyRes.data;
      if (d.error) {
        throw new BadRequestException(`Deriv: ${d.error.message}`);
      }

      const contract = d.buy;
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
        raw: d,
      };
    } catch (err: any) {
      const dErr = err?.response?.data?.error;
      const msg = dErr?.message || err?.response?.data?.message || err?.message || 'Unknown Deriv error';

      if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
        throw new ServiceUnavailableException('Deriv API timeout — retry later');
      }
      if (err?.response?.status === 429) {
        throw new ServiceUnavailableException('Deriv rate limit exceeded');
      }
      throw new BadRequestException(`Deriv order failed: ${msg}`);
    }
  }

  async getAccountBalance(apiKey: string, _apiSecret: string): Promise<BalanceResult[]> {
    try {
      const res = await axios.get(`${this.apiUrl}/balance`, {
        headers: { Authorization: apiKey },
        timeout: 10000,
      });

      const balance = res.data?.balance;
      if (!balance) {
        throw new BadRequestException('Deriv: no balance returned');
      }

      return [{
        asset: balance.currency || 'USD',
        free: String(balance.balance),
        locked: '0',
      }];
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Unknown error';
      this.logger.error(`Deriv balance failed: ${msg}`);
      throw new BadRequestException(`Deriv balance: ${msg}`);
    }
  }

  async validateCredentials(apiKey: string, apiSecret: string): Promise<boolean> {
    try {
      await this.getAccountBalance(apiKey, apiSecret);
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
