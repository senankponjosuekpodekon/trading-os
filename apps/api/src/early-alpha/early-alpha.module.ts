import { Module } from '@nestjs/common';
import { EarlyAlphaController } from './early-alpha.controller';

@Module({
  controllers: [EarlyAlphaController],
})
export class EarlyAlphaModule {}
