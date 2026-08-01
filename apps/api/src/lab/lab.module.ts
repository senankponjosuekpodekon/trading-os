import { Module } from '@nestjs/common';
import { LabService } from './lab.service';
import { LabController } from './lab.controller';
import { EngineHttpModule } from '../engine/engine-http.module';

@Module({
  imports: [EngineHttpModule],
  controllers: [LabController],
  providers: [LabService],
  exports: [LabService],
})
export class LabModule {}
