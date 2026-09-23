import { Module } from '@nestjs/common';
import { EarlyAlphaController } from './early-alpha.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [EarlyAlphaController],
})
export class EarlyAlphaModule {}
