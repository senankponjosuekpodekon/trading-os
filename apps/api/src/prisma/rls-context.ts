import { AsyncLocalStorage } from 'node:async_hooks';

// Propagates the authenticated user's id through the async call chain of a
// single HTTP request so PrismaService (RLS-enforced client) can scope every
// query to that user via a Postgres session variable (see prisma-rls.extension.ts).
export const rlsContext = new AsyncLocalStorage<string | undefined>();
