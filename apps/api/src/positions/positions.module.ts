import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { CrossPositionRiskService } from './cross-position-risk.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { JournalModule } from '../journal/journal.module';
import { AuditModule } from '../audit/audit.module';
import { SystemHealthModule } from '../system-health/system-health.module';

@Module({
  imports: [HttpModule, NotificationsModule, JournalModule, AuditModule, SystemHealthModule],
  controllers: [PositionsController],
  providers: [PositionsService, CrossPositionRiskService],
  exports: [PositionsService, CrossPositionRiskService],
})
export class PositionsModule {}
