import { PrismaClient } from '@prisma/client';
import { rlsContext } from './rls-context';

// Wraps a PrismaClient so every model call runs behind Postgres Row-Level
// Security, scoped to the current AsyncLocalStorage user id.
//
// IMPORTANT — why this is a plain Proxy and not a `$extends()` client
// extension: Prisma's extension `$allOperations` callback is invoked through
// the query engine's own async dispatch, which does NOT preserve
// AsyncLocalStorage context (verified empirically — `rlsContext.getStore()`
// reads back `undefined` inside `$allOperations` even though it is correctly
// set immediately before/after the call, synchronously). A plain Proxy reads
// the ALS store synchronously at property-access time (`proxy.portfolio`),
// which is still within the original `rlsContext.run()` call stack, so it
// never crosses that broken boundary.
//
// Each wrapped call becomes a 2-statement array-form `$transaction` — this
// form is guaranteed by Prisma to run on a single connection, unlike the
// interactive `async (tx) => {...}` form combined with extensions, which
// does not help here since we're not using extensions anymore. We avoid
// holding a transaction open for the whole request (bad for the connection
// pool during slow engine/LLM/exchange calls) by scoping it to just the one
// operation.
//
// If no user id is present (e.g. an unauthenticated route that never called
// rlsContext.run), the call passes through unmodified — `app.current_user_id`
// stays unset, so RLS policies fail closed (zero rows / insert rejected) on
// every protected table. This is intentional.
export function withRls(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      const orig = (target as any)[prop];
      if (typeof prop !== 'string' || typeof orig !== 'object' || orig === null || prop.startsWith('$')) {
        if (typeof orig === 'function') return orig.bind(target);
        return Reflect.get(target, prop, receiver);
      }
      const userId = rlsContext.getStore();
      return new Proxy(orig, {
        get(modelTarget, method, modelReceiver) {
          const fn = (modelTarget as any)[method];
          if (typeof fn !== 'function') return Reflect.get(modelTarget, method, modelReceiver);
          return (...args: any[]) => {
            if (!userId) return fn.apply(modelTarget, args);
            return prisma
              .$transaction([
                prisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
                fn.apply(modelTarget, args),
              ])
              .then(([, result]: any[]) => result);
          };
        },
      });
    },
  }) as unknown as PrismaClient;
}
