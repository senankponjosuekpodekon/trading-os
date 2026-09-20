import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MaintenanceService } from '../../admin/maintenance.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private maintenanceService: MaintenanceService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.maintenanceService.isMaintenanceMode()) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Super admin peut accéder même en mode maintenance
    if (user?.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    throw new ForbiddenException('Mode maintenance activé — seuls les super admins peuvent accéder');
  }
}
