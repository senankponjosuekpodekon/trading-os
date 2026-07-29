import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { rlsContext } from './rls-context';

// Global interceptor: makes the authenticated user's id available to
// PrismaService (RLS-enforced client) for the duration of the request via
// AsyncLocalStorage. Runs after guards, so `req.user` is already populated
// by JwtAuthGuard when present. Public routes simply leave the context
// unset, which means RLS-protected tables fail closed (0 rows) if touched —
// intentional; unauthenticated flows that legitimately need to write
// per-user data (register/login/logout) set the context explicitly
// (see auth.service.ts).
@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const userId = req?.user?.id;

    return new Observable((subscriber) => {
      rlsContext.run(userId, () => {
        next.handle().subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
