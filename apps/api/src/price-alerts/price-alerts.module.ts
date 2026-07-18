import { Module } from '@nestjs/common';
import { PriceAlertsController } from './price-alerts.controller';
import { PriceAlertsService } from './price-alerts.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [PriceAlertsController],
  providers: [PriceAlertsService],
  exports: [PriceAlertsService],
})
export class PriceAlertsModule {}
