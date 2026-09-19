import { Module } from '@nestjs/common';
import { CronConfigService } from './cron-config.service';

@Module({
  providers: [CronConfigService],
  exports: [CronConfigService],
})
export class CronConfigModule {}
