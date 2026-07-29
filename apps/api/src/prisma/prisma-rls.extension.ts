import { PrismaClient } from '@prisma/client';
import { rlsContext } from './rls-context';

// Wraps every query issued through the returned client so it runs behind
// Postgres Row-Level Security: each operation becomes a short 2-statement
// transaction — `SET LOCAL app.current_user_id` followed by the query itself
// — instead of holding a transaction open for the whole request (which would
// starve the connection pool during slow calls to the engine/LLM/exchange APIs).
//
// If no user id is present in the AsyncLocalStorage context (e.g. an
// unauthenticated route that never called rlsContext.run), the query still
// executes but `app.current_user_id` stays unset, so RLS policies fail closed
// (zero rows) on every protected table — this is intentional.
export function withRls(prisma: PrismaClient) {
  return prisma.$extends({
    name: 'rls',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const userId = rlsContext.getStore();
          if (!userId) {
            return query(args);
          }
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
