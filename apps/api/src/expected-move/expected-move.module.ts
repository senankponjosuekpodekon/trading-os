import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExpectedMoveController } from './expected-move.controller';
import { ExpectedMoveService } from './expected-move.service';

@Module({
  imports: [HttpModule],
  controllers: [ExpectedMoveController],
  providers: [ExpectedMoveService],
  exports: [ExpectedMoveService],
})
export class ExpectedMoveModule {}
