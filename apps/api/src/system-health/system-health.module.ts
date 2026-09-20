import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SystemHealthService } from './system-health.service';
import { SystemHealthController } from './system-health.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { EngineHttpModule } from '../engine/engine-http.module';
import { CronConfigModule } from '../admin/cron-config.module';

@Module({
  imports: [HttpModule, NotificationsModule, EngineHttpModule, CronConfigModule],
  controllers: [SystemHealthController],
  providers: [SystemHealthService],
  exports: [SystemHealthService],
})
export class SystemHealthModule {}
