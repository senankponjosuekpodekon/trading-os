import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

@Injectable()
export class BinanceConnector implements ExchangeConnector {
  readonly exchange = ExchangeName.BINANCE;
  private readonly logger = new Logger(BinanceConnector.name);
  private readonly baseUrl: string;
  private readonly testnetUrl: string;
  private readonly useTestnet: boolean;

  constructor(private config: ConfigService) {
    this.baseUrl = 'https://api.binance.com';
    this.testnetUrl = 'https://testnet.binance.vision';
    this.useTestnet = this.config.get<string>('BINANCE_USE_TESTNET') === 'true';
  }

  private getClient(apiKey: string): AxiosInstance {
    const base = this.useTestnet ? this.testnetUrl : this.baseUrl;
    return axios.create({
      baseURL: base,
      timeout: 10000,
      headers: { 'X-MBX-APIKEY': apiKey },
    });
  }

  private sign(params: string, apiSecret: string): string {
    return crypto.createHmac('sha256', apiSecret).update(params).digest('hex');
  }

  async placeOrder(apiKey: string, apiSecret: string, params: OrderParams): Promise<OrderResult> {
    const client = this.getClient(apiKey);

    const queryParams: Record<string, string | number> = {
      symbol: params.symbol.replace('/', ''),
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      timestamp: Date.now(),
      recvWindow: 5000,
    };

    if (params.price && params.type === 'LIMIT') {
      queryParams.price = params.price;
      queryParams.timeInForce = params.timeInForce || 'GTC';
    }

    if (params.stopPrice) {
      queryParams.stopPrice = params.stopPrice;
    }

    const queryStr = new URLSearchParams(
      Object.entries(queryParams).map(([k, v]) => [k, String(v)]),
    ).toString();

    const signature = this.sign(queryStr, apiSecret);
    const finalUrl = `/api/v3/order?${queryStr}&signature=${signature}`;

    try {
      const response = await client.post(finalUrl);
      const d = response.data;
      const fills = d.fills ?? [];
      const avgPrice = d.avgPrice && d.avgPrice !== '0'
        ? d.avgPrice
        : fills.length > 0
          ? (fills.reduce((acc: number, f: any) => acc + parseFloat(f.price) * parseFloat(f.qty), 0) / Math.max(parseFloat(d.executedQty), 1)).toFixed(8)
          : '0';

      return {
        orderId: String(d.orderId),
        symbol: d.symbol,
        side: d.side,
        type: d.type,
        status: d.status,
        executedQty: d.executedQty,
        avgPrice,
        transactTime: d.transactTime,
        exchange: ExchangeName.BINANCE,
        raw: d,
      };
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.msg || err?.message || 'Unknown Binance error';

      if (status === 429 || status === 418) {
        throw new ServiceUnavailableException(`Binance rate limit: ${msg}`);
      }
      if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
        throw new ServiceUnavailableException('Binance API timeout — retry later');
      }
      throw new BadRequestException(`Binance order failed: ${msg}`);
    }
  }

  async getAccountBalance(apiKey: string, apiSecret: string): Promise<BalanceResult[]> {
    const client = this.getClient(apiKey);
    const params = `timestamp=${Date.now()}&recvWindow=5000`;
    const signature = this.sign(params, apiSecret);

    try {
      const response = await client.get(`/api/v3/account?${params}&signature=${signature}`);
      return response.data.balances
        .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map((b: any) => ({ asset: b.asset, free: b.free, locked: b.locked }));
    } catch (err: any) {
      const msg = err?.response?.data?.msg || err?.message || 'Unknown error';
      this.logger.error(`Binance balance failed: ${msg}`);
      throw new BadRequestException(`Binance balance: ${msg}`);
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
}
