import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { RlsContextInterceptor } from './prisma/rls-context.interceptor';
import { ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { SecurityModule } from './common/security/security.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PortfoliosModule } from './portfolios/portfolios.module';
import { SignalsModule } from './signals/signals.module';
import { PositionsModule } from './positions/positions.module';
import { JournalModule } from './journal/journal.module';
import { StrategiesModule } from './strategies/strategies.module';
import { BacktestModule } from './backtest/backtest.module';
import { LabModule } from './lab/lab.module';
import { BillingModule } from './billing/billing.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PriceAlertsModule } from './price-alerts/price-alerts.module';
import { AuditModule } from './audit/audit.module';
import { DbPerformanceModule } from './db-performance/db-performance.module';
import { ScheduleModule } from '@nestjs/schedule';
import { WatcherModule } from './watcher/watcher.module';
import { MarketDataModule } from './market-data/market-data.module';
import { AiModule } from './ai/ai.module';
import { EarlyAlphaModule } from './early-alpha/early-alpha.module';
import { PhaseBModule } from './phase-b/phase-b.module';
import { PhaseCModule } from './phase-c/phase-c.module';
import { ExpectedMoveModule } from './expected-move/expected-move.module';
import { SystemHealthModule } from './system-health/system-health.module';
import { EngineProxyModule } from './engine-proxy/engine-proxy.module';
import { PricesProxyModule } from './prices-proxy/prices-proxy.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { ExchangeConnectionsModule } from './exchange-connections/exchange-connections.module';
import { ExecutionModule } from './execution/execution.module';
import { SignalChannelsModule } from './signal-channels/signal-channels.module';
import { SignalDistributionModule } from './signal-distribution/signal-distribution.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 1_000,  limit: 10  },
      { name: 'medium', ttl: 10_000, limit: 50  },
      { name: 'long',   ttl: 60_000, limit: 200 },
    ]),
    ScheduleModule.forRoot(),
    WatcherModule,
    MarketDataModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    PortfoliosModule,
    SignalsModule,
    PositionsModule,
    JournalModule,
    StrategiesModule,
    BacktestModule,
    LabModule,
    BillingModule,
    MetricsModule,
    NotificationsModule,
    PriceAlertsModule,
    AuditModule,
    DbPerformanceModule,
    AiModule,
    EarlyAlphaModule,
    PhaseBModule,
    PhaseCModule,
    ExpectedMoveModule,
    SystemHealthModule,
    EngineProxyModule,
    PricesProxyModule,
    SystemSettingsModule,
    ExchangeConnectionsModule,
    ExecutionModule,
    SignalChannelsModule,
    SignalDistributionModule,
    SecurityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    RolesGuard,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RlsContextInterceptor },
  ],
})
export class AppModule {}
