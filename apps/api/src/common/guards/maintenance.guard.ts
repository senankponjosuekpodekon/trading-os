import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { MaintenanceService } from '../../admin/maintenance.service';
import { ApplicationException } from '../errors/application.exception';
import { ErrorCode } from '../errors/error-codes';

// Routes toujours accessibles en maintenance : auth (login), health,
// admin (pour pouvoir désactiver le mode — protégées par leurs guards)
const ALLOWED_PATHS = [/^\/api\/auth\//, /^\/api\/health/, /^\/api\/admin\//];

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private maintenanceService: MaintenanceService,
    private config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await this.maintenanceService.isMaintenanceMode())) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const url: string = request.url ?? '';

    if (ALLOWED_PATHS.some((re) => re.test(url))) {
      return true;
    }

    // Les admins passent : le guard global tourne avant JwtAuthGuard,
    // on décode donc le token directement depuis le cookie/header.
    const token: string | undefined =
      request.cookies?.['access_token'] ??
      request.headers?.authorization?.replace(/^Bearer\s+/i, '');

    if (token) {
      try {
        const payload = await new JwtService({
          secret: this.config.get<string>('JWT_SECRET'),
        }).verifyAsync<{ role?: string }>(token);
        if (payload.role === UserRole.ADMIN || payload.role === UserRole.SUPER_ADMIN) {
          return true;
        }
      } catch {
        // token invalide/expiré → traité comme user non-admin
      }
    }

    throw new ApplicationException(
      ErrorCode.MAINTENANCE_MODE,
      'Mode maintenance activé — réessayez dans quelques minutes',
    );
  }
}
