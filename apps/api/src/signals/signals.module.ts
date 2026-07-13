import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [HttpModule, NotificationsModule],
  controllers: [SignalsController],
  providers: [SignalsService, SignalOutcomeService],
  exports: [SignalsService, SignalOutcomeService],
})
export class SignalsModule {}
