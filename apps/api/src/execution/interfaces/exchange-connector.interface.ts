import { ExchangeName } from '../../exchange-connections/dto/exchange-connection.dto';

export interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT';
  quantity: number;
  price?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  stopPrice?: number;
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  executedQty: string;
  avgPrice: string;
  transactTime: number;
  exchange: ExchangeName;
  raw?: any;
}

export interface BalanceResult {
  asset: string;
  free: string;
  locked: string;
}

export interface ExchangeConnector {
  readonly exchange: ExchangeName;

  placeOrder(apiKey: string, apiSecret: string, params: OrderParams): Promise<OrderResult>;
  getAccountBalance(apiKey: string, apiSecret: string): Promise<BalanceResult[]>;
  validateCredentials(apiKey: string, apiSecret: string): Promise<boolean>;
}

export class ExchangeConnectorFactory {
  private static connectors = new Map<ExchangeName, ExchangeConnector>();

  static register(connector: ExchangeConnector) {
    this.connectors.set(connector.exchange, connector);
  }

  static get(exchange: ExchangeName): ExchangeConnector | undefined {
    return this.connectors.get(exchange);
  }

  static has(exchange: ExchangeName): boolean {
    return this.connectors.has(exchange);
  }

  static supported(): ExchangeName[] {
    return Array.from(this.connectors.keys());
  }
}
