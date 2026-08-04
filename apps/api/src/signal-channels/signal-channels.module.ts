import { Module } from '@nestjs/common';
import { SignalChannelsController } from './signal-channels.controller';
import { SignalChannelsService } from './signal-channels.service';

@Module({
  controllers: [SignalChannelsController],
  providers: [SignalChannelsService],
  exports: [SignalChannelsService],
})
export class SignalChannelsModule {}
