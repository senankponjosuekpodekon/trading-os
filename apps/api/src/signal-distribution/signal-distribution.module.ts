import { Module } from '@nestjs/common';
import { SignalDistributionService } from './signal-distribution.service';
import { TelegramDispatcher, DiscordDispatcher } from './dispatchers';

@Module({
  providers: [SignalDistributionService, TelegramDispatcher, DiscordDispatcher],
  exports: [SignalDistributionService],
})
export class SignalDistributionModule {}
