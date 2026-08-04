import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeConnectionsService } from '../exchange-connections/exchange-connections.service';
import { BinanceConnector } from './binance.connector';
import { DerivConnector } from './deriv.connector';
import { BrvmConnector } from './brvm.connector';
import { OandaConnector } from './oanda.connector';
import { Mt5Connector } from './mt5.connector';
import { ExchangeConnectorFactory } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';
import { ExecuteOrderDto } from './dto/execute-order.dto';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private prisma: PrismaService,
    private exchangeConnections: ExchangeConnectionsService,
    private binance: BinanceConnector,
    private deriv: DerivConnector,
    private brvm: BrvmConnector,
    private oanda: OandaConnector,
    private mt5: Mt5Connector,
  ) {
    ExchangeConnectorFactory.register(binance);
    ExchangeConnectorFactory.register(deriv);
    ExchangeConnectorFactory.register(brvm);
    ExchangeConnectorFactory.register(oanda);
    ExchangeConnectorFactory.register(mt5);
  }

  async executeOrder(userId: string, dto: ExecuteOrderDto) {
    const creds = await this.exchangeConnections.getDecryptedCredentials(userId, dto.connectionId);

    const connector = ExchangeConnectorFactory.get(creds.exchange as ExchangeName);
    if (!connector) {
      throw new BadRequestException(
        `Exchange "${creds.exchange}" non supporté. Exchanges disponibles: ${ExchangeConnectorFactory.supported().join(', ')}`
      );
    }

    this.logger.log(`Executing order: user=${userId} exchange=${creds.exchange} symbol=${dto.symbol} side=${dto.side} type=${dto.type} qty=${dto.quantity}`);

    let result;
    try {
      result = await connector.placeOrder(creds.apiKey, creds.apiSecret, {
        symbol: dto.symbol,
        side: dto.side,
        type: dto.type,
        quantity: dto.quantity,
        price: dto.price,
        timeInForce: dto.timeInForce,
        stopPrice: dto.stopPrice,
      });
    } catch (err: any) {
      await this.exchangeConnections.markValidated(userId, dto.connectionId, false, err?.message);
      throw err;
    }

    await this.exchangeConnections.markValidated(userId, dto.connectionId, true);

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ORDER_EXECUTED',
        resource: 'execution',
        details: {
          exchange: creds.exchange,
          symbol: dto.symbol,
          side: dto.side,
          type: dto.type,
          quantity: dto.quantity,
          orderId: result.orderId,
          status: result.status,
          avgPrice: result.avgPrice,
          signalId: dto.signalId,
        },
      },
    });

    if (dto.portfolioId) {
      await this.createPositionFromOrder(userId, dto, result);
    }

    this.logger.log(`Order executed: exchange=${creds.exchange} orderId=${result.orderId} status=${result.status}`);

    return {
      success: true,
      exchange: creds.exchange,
      orderId: result.orderId,
      symbol: result.symbol,
      side: result.side,
      type: result.type,
      status: result.status,
      executedQty: result.executedQty,
      avgPrice: result.avgPrice,
      transactTime: result.transactTime,
      ...(result.raw?.ticket && { manualTicket: result.raw.ticket }),
      ...(result.raw?.brokerInstructions && { brokerInstructions: result.raw.brokerInstructions }),
    };
  }

  async validateConnection(userId: string, connectionId: string) {
    const creds = await this.exchangeConnections.getDecryptedCredentials(userId, connectionId);

    const connector = ExchangeConnectorFactory.get(creds.exchange as ExchangeName);
    if (!connector) {
      throw new BadRequestException(
        `Exchange "${creds.exchange}" non supporté pour validation.`
      );
    }

    const valid = await connector.validateCredentials(creds.apiKey, creds.apiSecret);
    await this.exchangeConnections.markValidated(userId, connectionId, valid, valid ? undefined : 'Credential validation failed');

    return { valid, exchange: creds.exchange };
  }

  async getBalance(userId: string, connectionId: string) {
    const creds = await this.exchangeConnections.getDecryptedCredentials(userId, connectionId);

    const connector = ExchangeConnectorFactory.get(creds.exchange as ExchangeName);
    if (!connector) {
      throw new BadRequestException(
        `Exchange "${creds.exchange}" non supporté pour le solde.`
      );
    }

    return connector.getAccountBalance(creds.apiKey, creds.apiSecret);
  }

  async getSupportedExchanges() {
    return ExchangeConnectorFactory.supported().map(name => ({
      exchange: name,
      supported: true,
    }));
  }

  private async createPositionFromOrder(userId: string, dto: ExecuteOrderDto, result: any) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: dto.portfolioId, userId },
    });
    if (!portfolio || !dto.portfolioId) return;

    const asset = await this.prisma.asset.findUnique({ where: { symbol: dto.symbol } });
    if (!asset) {
      this.logger.warn(`Asset not found for symbol ${dto.symbol} — position not created`);
      return;
    }

    await this.prisma.position.create({
      data: {
        portfolioId: dto.portfolioId,
        assetId: asset.id,
        direction: dto.side as any,
        status: result.status === 'MANUAL' ? 'PENDING' : 'OPEN',
        entryPrice: parseFloat(result.avgPrice) || dto.price || 0,
        quantity: parseFloat(result.executedQty) || dto.quantity,
        stopLoss: null,
        takeProfit: null,
        signalId: dto.signalId,
      },
    });

    this.logger.log(`Position created from order: portfolio=${dto.portfolioId} symbol=${dto.symbol}`);
  }
}
