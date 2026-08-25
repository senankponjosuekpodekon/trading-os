import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SystemHealthService } from './system-health.service';
import { SystemHealthController } from './system-health.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { EngineHttpModule } from '../engine/engine-http.module';

@Module({
  imports: [HttpModule, NotificationsModule, EngineHttpModule],
  controllers: [SystemHealthController],
  providers: [SystemHealthService],
  exports: [SystemHealthService],
})
export class SystemHealthModule {}
