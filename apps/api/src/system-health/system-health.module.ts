import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SystemHealthService } from './system-health.service';
import { SystemHealthController } from './system-health.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [HttpModule, NotificationsModule],
  controllers: [SystemHealthController],
  providers: [SystemHealthService],
  exports: [SystemHealthService],
})
export class SystemHealthModule {}
