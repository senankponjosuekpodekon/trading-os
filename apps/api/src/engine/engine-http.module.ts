import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EngineHttpService } from './engine-http.service';

@Module({
  imports: [HttpModule],
  providers: [EngineHttpService],
  exports: [EngineHttpService],
})
export class EngineHttpModule {}
