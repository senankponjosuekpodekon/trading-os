import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { NotificationsModule } from './notifications/notifications.module';
import { ScheduleModule } from '@nestjs/schedule';
import { WatcherModule } from './watcher/watcher.module';
import { AiModule } from './ai/ai.module';

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
    PrismaModule,
    AuthModule,
    UsersModule,
    PortfoliosModule,
    SignalsModule,
    PositionsModule,
    JournalModule,
    StrategiesModule,
    NotificationsModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
