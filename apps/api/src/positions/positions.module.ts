import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { JournalModule } from '../journal/journal.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [HttpModule, NotificationsModule, JournalModule, AuditModule],
  controllers: [PositionsController],
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}
