import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

const ROLE_HIERARCHY: Record<UserRole, UserRole[]> = {
  TRADER: ['TRADER'],
  INVESTOR: ['INVESTOR', 'TRADER'],
  ADMIN: ['ADMIN', 'INVESTOR', 'TRADER'],
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'INVESTOR', 'TRADER'],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const userPermissions = ROLE_HIERARCHY[user.role as UserRole] ?? [];
    return requiredRoles.some((role) => userPermissions.includes(role));
  }
}
