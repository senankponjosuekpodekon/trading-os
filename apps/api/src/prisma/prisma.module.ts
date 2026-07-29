import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService, PrismaSystemService } from './prisma.service';
import { withRls } from './prisma-rls.extension';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => {
        const client = new PrismaClient({
          datasourceUrl: process.env.APP_RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL,
        });
        // No eager $connect() here — Prisma connects lazily on first query,
        // same as the plain `PrismaService extends PrismaClient` class did
        // before (connection only happened via onModuleInit, which Nest only
        // calls once the app/module is actually initialized, not at compile
        // time in unit/integration tests that never call app.init()).
        // Cast: the RLS-extended client exposes the same model delegate API
        // as PrismaClient (constructor(private prisma: PrismaService) call
        // sites are unaffected) but is not a real `PrismaService` instance —
        // see the note in prisma.service.ts.
        return withRls(client) as unknown as PrismaService;
      },
    },
    PrismaSystemService,
  ],
  exports: [PrismaService, PrismaSystemService],
})
export class PrismaModule {}
