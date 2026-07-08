import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [HttpModule, NotificationsModule],
  controllers: [SignalsController],
  providers: [SignalsService],
  exports: [SignalsService],
})
export class SignalsModule {}
