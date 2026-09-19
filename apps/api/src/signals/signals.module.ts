import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { SignalExecutionService } from './signal-execution.service';
import { SignalTrackerService } from './signal-tracker.service';
import { SignalTrackerScheduler } from './signal-tracker.scheduler';
import { EngineCandleRepository } from './engine-candle.repository';
import { LocalCandleRepository } from './local-candle.repository';
import { SignalStatsService } from './signal-stats.service';
import { SignalPredictorService } from './signal-predictor.service';
import { PatternPredictorService } from './pattern-predictor.service';
import { FeatureStoreService } from './feature-store.service';
import { RegimeClassifierService } from './regime-classifier.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { BillingModule } from '../billing/billing.module';
import { EngineHttpModule } from '../engine/engine-http.module';
import { SystemHealthModule } from '../system-health/system-health.module';
import { ExpectedMoveModule } from '../expected-move/expected-move.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CronConfigModule } from '../admin/cron-config.module';

@Module({
  imports: [HttpModule, AuthModule, EngineHttpModule, NotificationsModule, MarketDataModule, BillingModule, SystemHealthModule, ExpectedMoveModule, PrismaModule, CronConfigModule],
  controllers: [SignalsController],
  providers: [
    SignalsService,
    SignalOutcomeService,
    SignalExecutionService,
    SignalTrackerService,
    SignalTrackerScheduler,
    SignalStatsService,
    { provide: 'CandleRepository', useClass: LocalCandleRepository },
    SignalPredictorService,
    PatternPredictorService,
    FeatureStoreService,
    RegimeClassifierService,
  ],
  exports: [SignalsService, SignalOutcomeService, SignalExecutionService, SignalPredictorService, PatternPredictorService, FeatureStoreService, RegimeClassifierService],
})
export class SignalsModule {}
