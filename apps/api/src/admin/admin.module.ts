import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminOpsController } from './admin-ops.controller';
import { AdminLogsController } from './admin-logs.controller';
import { AssetConfigController } from './asset-config.controller';
import { AssetConfigService } from './asset-config.service';
import { CronConfigService } from './cron-config.service';
import { MaintenanceService } from './maintenance.service';
import { FeatureFlagsService } from '../common/services/feature-flags.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SystemHealthModule } from '../system-health/system-health.module';

@Module({
  imports: [PrismaModule, AuthModule, SystemHealthModule],
  controllers: [AdminUsersController, AdminOpsController, AdminLogsController, AssetConfigController],
  providers: [AssetConfigService, CronConfigService, MaintenanceService, FeatureFlagsService],
  exports: [MaintenanceService],
})
export class AdminModule {}
