import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AdminUsersController } from './admin-users.controller';
import { AdminOpsController } from './admin-ops.controller';
import { AdminLogsController } from './admin-logs.controller';
import { AssetConfigController } from './asset-config.controller';
import { AssetConfigService } from './asset-config.service';
import { CronConfigService } from './cron-config.service';
import { MaintenanceService } from './maintenance.service';
import { Mt5ReadService } from './mt5-read.service';
import { AutopilotReadService } from './autopilot-read.service';
import { AutopilotMarksScheduler } from './autopilot-marks.scheduler';
import { FeatureFlagsService } from '../common/services/feature-flags.service';
import { LocalCandleRepository } from '../signals/local-candle.repository';
import { EngineCandleRepository } from '../signals/engine-candle.repository';
import { BinanceCandleRepository } from '../signals/binance-candle.repository';
import { YahooCandleRepository } from '../signals/yahoo-candle.repository';
import { TwelveDataCandleRepository } from '../signals/twelvedata-candle.repository';
import { AlphaVantageCandleRepository } from '../signals/alphavantage-candle.repository';
import { HybridCandleRepository } from '../signals/hybrid-candle.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SystemHealthModule } from '../system-health/system-health.module';

@Module({
  imports: [HttpModule, PrismaModule, AuthModule, SystemHealthModule],
  controllers: [AdminUsersController, AdminOpsController, AdminLogsController, AssetConfigController],
  providers: [AssetConfigService, CronConfigService, MaintenanceService, FeatureFlagsService, Mt5ReadService, AutopilotReadService,
    LocalCandleRepository, EngineCandleRepository, BinanceCandleRepository, YahooCandleRepository,
    TwelveDataCandleRepository, AlphaVantageCandleRepository, HybridCandleRepository, AutopilotMarksScheduler],
  exports: [MaintenanceService],
})
export class AdminModule {}
