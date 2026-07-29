import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  const buildContext = (user?: any): ExecutionContext => {
    const handler = jest.fn();
    const klass = jest.fn();
    return {
      getHandler: () => handler,
      getClass: () => klass,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no roles are required on the route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = buildContext({ role: 'USER' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies access when roles are required but request has no user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = buildContext(undefined);

    expect(guard.canActivate(context)).toBeFalsy();
  });

  it('denies access when user role is not among required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = buildContext({ role: 'USER' });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('allows access when user role matches one of the required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'USER']);
    const context = buildContext({ role: 'USER' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('reads metadata from both handler and class via getAllAndOverride', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = buildContext({ role: 'ADMIN' });

    guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith('roles', [context.getHandler(), context.getClass()]);
  });
});
