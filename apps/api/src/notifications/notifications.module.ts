import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AlertService } from './alert.service';

@Module({
  controllers: [NotificationsController],
  providers:   [NotificationsService, AlertService],
  exports:     [NotificationsService, AlertService],
})
export class NotificationsModule {}
