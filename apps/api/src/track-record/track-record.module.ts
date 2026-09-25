import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TrackRecordController } from './track-record.controller';
import { TrackRecordService } from './track-record.service';

@Module({
  imports: [HttpModule],
  controllers: [TrackRecordController],
  providers: [TrackRecordService],
  exports: [TrackRecordService],
})
export class TrackRecordModule {}
