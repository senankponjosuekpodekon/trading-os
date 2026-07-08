import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [HttpModule, NotificationsModule],
  controllers: [PositionsController],
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}
