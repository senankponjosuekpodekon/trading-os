import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WatcherService } from './watcher.service';
import { PositionsModule } from '../positions/positions.module';
import { JournalModule } from '../journal/journal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PriceAlertsModule } from '../price-alerts/price-alerts.module';

@Module({
  imports: [HttpModule, PositionsModule, JournalModule, NotificationsModule, PriceAlertsModule],
  providers: [WatcherService],
})
export class WatcherModule {}
