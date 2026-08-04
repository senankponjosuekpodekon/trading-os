import { Module } from '@nestjs/common';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { BinanceConnector } from './binance.connector';
import { DerivConnector } from './deriv.connector';
import { BrvmConnector } from './brvm.connector';
import { OandaConnector } from './oanda.connector';
import { Mt5Connector } from './mt5.connector';
import { ExchangeConnectionsModule } from '../exchange-connections/exchange-connections.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ExchangeConnectionsModule, ConfigModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, BinanceConnector, DerivConnector, BrvmConnector, OandaConnector, Mt5Connector],
  exports: [ExecutionService],
})
export class ExecutionModule {}
