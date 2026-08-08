import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminOpsController } from './admin-ops.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SystemHealthModule } from '../system-health/system-health.module';

@Module({
  imports: [PrismaModule, AuthModule, SystemHealthModule],
  controllers: [AdminUsersController, AdminOpsController],
})
export class AdminModule {}
