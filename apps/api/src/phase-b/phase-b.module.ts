import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MlFeedbackController } from './ml-feedback.controller';
import { MlFeedbackService } from './ml-feedback.service';
import { PhaseBDataController } from './phase-b-data.controller';
import { PhaseBDataService } from './phase-b-data.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [HttpModule],
  controllers: [MlFeedbackController, PhaseBDataController],
  providers: [MlFeedbackService, PhaseBDataService, PrismaService],
  exports: [MlFeedbackService],
})
export class PhaseBModule {}
