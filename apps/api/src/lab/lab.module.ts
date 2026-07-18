import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LabService } from './lab.service';
import { LabController } from './lab.controller';

@Module({
  imports: [HttpModule],
  controllers: [LabController],
  providers: [LabService],
  exports: [LabService],
})
export class LabModule {}
