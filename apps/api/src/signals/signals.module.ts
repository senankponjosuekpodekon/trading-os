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

@Module({
  imports: [HttpModule, NotificationsModule, MarketDataModule, BillingModule],
  controllers: [SignalsController],
  providers: [SignalsService, SignalOutcomeService, SignalPredictorService, PatternPredictorService, FeatureStoreService, RegimeClassifierService],
  exports: [SignalsService, SignalOutcomeService, SignalPredictorService, PatternPredictorService, FeatureStoreService, RegimeClassifierService],
})
export class SignalsModule {}
