import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TrackRecordController } from './track-record.controller';
import { TrackRecordService } from './track-record.service';
import { CronConfigModule } from '../admin/cron-config.module';

@Module({
  imports: [HttpModule, CronConfigModule],
  controllers: [TrackRecordController],
  providers: [TrackRecordService],
  exports: [TrackRecordService],
})
export class TrackRecordModule {}
