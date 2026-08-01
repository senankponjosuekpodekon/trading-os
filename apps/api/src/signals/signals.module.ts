import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { SignalPredictorService } from './signal-predictor.service';
import { PatternPredictorService } from './pattern-predictor.service';
import { FeatureStoreService } from './feature-store.service';
import { RegimeClassifierService } from './regime-classifier.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { BillingModule } from '../billing/billing.module';
import { EngineHttpModule } from '../engine/engine-http.module';
import { SystemHealthModule } from '../system-health/system-health.module';

@Module({
  imports: [HttpModule, EngineHttpModule, NotificationsModule, MarketDataModule, BillingModule, SystemHealthModule],
  controllers: [SignalsController],
  providers: [SignalsService, SignalOutcomeService, SignalPredictorService, PatternPredictorService, FeatureStoreService, RegimeClassifierService],
  exports: [SignalsService, SignalOutcomeService, SignalPredictorService, PatternPredictorService, FeatureStoreService, RegimeClassifierService],
})
export class SignalsModule {}
