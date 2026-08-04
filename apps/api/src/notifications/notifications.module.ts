import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AlertService } from './alert.service';
import { NotificationPreferenceService } from './notification-preference.service';

@Module({
  controllers: [NotificationsController],
  providers:   [NotificationsService, AlertService, NotificationPreferenceService],
  exports:     [NotificationsService, AlertService, NotificationPreferenceService],
})
export class NotificationsModule {}
