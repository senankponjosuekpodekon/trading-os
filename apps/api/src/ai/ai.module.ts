import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { LlmQuotaService } from './llm-quota.service';
import { EngineHttpModule } from '../engine/engine-http.module';

@Module({
  imports: [EngineHttpModule, HttpModule],
  controllers: [AiController],
  providers: [AiService, LlmQuotaService],
  exports: [AiService],
})
export class AiModule {}
