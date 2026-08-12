import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException, ConflictException } from '@nestjs/common';
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
import { ConfirmOrderDto } from './dto/confirm-order.dto';
import { ExecutionGateService } from './execution-gate.service';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private prisma: PrismaService,
    private exchangeConnections: ExchangeConnectionsService,
    private gate: ExecutionGateService,
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

    // ── Pre-execution validation (if signal-based order) ──────────────
    let signalData: any = null;
    let gateZone: any = null;
    if (dto.signalId && dto.portfolioId) {
      const portfolio = await this.prisma.portfolio.findFirst({
        where: { id: dto.portfolioId, userId },
      });
      if (!portfolio) {
        throw new NotFoundException('Portfolio not found');
      }

      const fillPrice = dto.price ?? (await this._estimateFillPrice(dto.symbol, connector, creds));
      if (!fillPrice) {
        throw new BadRequestException('Cannot estimate fill price for gate validation');
      }

      const portfolioType = portfolio.type as 'PAPER' | 'LIVE';
      const { signal, gateResult } = await this.gate.validateSignalExecution(
        dto.signalId,
        portfolio.id,
        fillPrice,
        portfolioType,
      );
      signalData = signal;
      gateZone = gateResult.zone ?? null;

      this.logger.log(
        `Pre-execution gate passed: signal=${dto.signalId} symbol=${dto.symbol} ` +
        `fillPrice=${fillPrice} zone=${gateZone ? `[${gateZone.lower}, ${gateZone.upper}]` : 'N/A'}`,
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
          gateZone,
        },
      },
    });

    if (dto.portfolioId) {
      await this.createPositionFromOrder(userId, dto, result, signalData);
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

  private async _estimateFillPrice(symbol: string, connector: any, creds: any): Promise<number | null> {
    try {
      const ticker = await connector.getTickerPrice?.(creds.apiKey, creds.apiSecret, symbol);
      if (ticker && typeof ticker === 'number') return ticker;
      if (ticker && ticker.price) return parseFloat(ticker.price);
    } catch {
      // fallback below
    }
    return null;
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

  async confirmOrder(userId: string, dto: ConfirmOrderDto) {
    const position = await this.prisma.position.findFirst({
      where: { id: dto.positionId },
      include: { portfolio: true, asset: { select: { symbol: true } } },
    });
    if (!position) throw new NotFoundException('Position not found');
    if (position.portfolio.userId !== userId) throw new NotFoundException('Position not found');
    if (position.status !== 'PENDING') {
      throw new BadRequestException(`Position is not PENDING (current: ${position.status})`);
    }

    const updateData: any = { status: 'OPEN' };
    if (dto.fillPrice) updateData.entryPrice = dto.fillPrice;
    if (dto.fillQuantity) {
      updateData.quantity = dto.fillQuantity;
      updateData.originalQuantity = dto.fillQuantity;
    }

    const updated = await this.prisma.position.update({
      where: { id: dto.positionId },
      data: updateData,
    });

    this.logger.log(
      `Position confirmed: id=${dto.positionId} symbol=${position.asset.symbol} ` +
      `fillPrice=${dto.fillPrice ?? 'N/A'} fillQty=${dto.fillQuantity ?? 'N/A'}`,
    );

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'POSITION_CONFIRMED',
        resource: 'execution',
        details: {
          positionId: dto.positionId,
          symbol: position.asset.symbol,
          fillPrice: dto.fillPrice,
          fillQuantity: dto.fillQuantity,
        },
      },
    });

    return { success: true, position: updated };
  }

  private async createPositionFromOrder(userId: string, dto: ExecuteOrderDto, result: any, signalData?: any) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: dto.portfolioId, userId },
    });
    if (!portfolio || !dto.portfolioId) return;

    const asset = await this.prisma.asset.findUnique({ where: { symbol: dto.symbol } });
    if (!asset) {
      this.logger.warn(`Asset not found for symbol ${dto.symbol} — position not created`);
      return;
    }

    // ── Populate SL/TP: priority DTO > signal > null ──────────────────
    const stopLoss =
      dto.stopLoss ??
      (signalData?.stopLoss ? parseFloat(signalData.stopLoss.toString()) : null);
    const takeProfit =
      dto.takeProfit ??
      (signalData?.takeProfit1 ? parseFloat(signalData.takeProfit1.toString()) : null);
    const takeProfit2 =
      dto.takeProfit2 ??
      (signalData?.takeProfit2 ? parseFloat(signalData.takeProfit2.toString()) : null);
    const trailingStop = stopLoss; // initialize trailing stop at SL

    const entryPrice = parseFloat(result.avgPrice) || dto.price || 0;
    const quantity = parseFloat(result.executedQty) || dto.quantity;

    const position = await this.prisma.position.create({
      data: {
        portfolioId: dto.portfolioId,
        assetId: asset.id,
        direction: dto.side as any,
        status: result.status === 'MANUAL' ? 'PENDING' : 'OPEN',
        entryPrice,
        quantity,
        originalQuantity: quantity,
        stopLoss,
        takeProfit,
        takeProfit2,
        trailingStop,
        signalId: dto.signalId,
      },
    });

    this.logger.log(
      `Position created from order: portfolio=${dto.portfolioId} symbol=${dto.symbol} ` +
      `SL=${stopLoss ?? '—'} TP=${takeProfit ?? '—'} TP2=${takeProfit2 ?? '—'} ` +
      `status=${position.status}`,
    );
  }
}
