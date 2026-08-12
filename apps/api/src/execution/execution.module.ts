import { Module } from '@nestjs/common';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ExecutionGateService } from './execution-gate.service';
import { BinanceConnector } from './binance.connector';
import { DerivConnector } from './deriv.connector';
import { BrvmConnector } from './brvm.connector';
import { OandaConnector } from './oanda.connector';
import { Mt5Connector } from './mt5.connector';
import { ExchangeConnectionsModule } from '../exchange-connections/exchange-connections.module';
import { PositionsModule } from '../positions/positions.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ExchangeConnectionsModule, PositionsModule, ConfigModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, ExecutionGateService, BinanceConnector, DerivConnector, BrvmConnector, OandaConnector, Mt5Connector],
  exports: [ExecutionService, ExecutionGateService],
})
export class ExecutionModule {}
