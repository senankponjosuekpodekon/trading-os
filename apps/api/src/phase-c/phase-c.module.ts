import { Module } from '@nestjs/common';
import { PhaseCController } from './phase-c.controller';

@Module({
  controllers: [PhaseCController],
})
export class PhaseCModule {}
