import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// NOTE: this class is only used as a DI token / TypeScript type for
// `constructor(private prisma: PrismaService)` across the app. The actual
// instance injected at runtime is a Row-Level-Security-wrapped client
// produced by PrismaModule's factory provider (see prisma.module.ts and
// prisma-rls.extension.ts) — connecting as the low-privilege `app_runtime`
// DB role. It is never instantiated directly via `new PrismaService()`.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

// Used for cron/system jobs that legitimately need cross-user access
// (trailing-stop sync, position watcher, signal outcome resolver, scheduled
// scans...). Connects as the DB owner role and bypasses RLS by design.
@Injectable()
export class PrismaSystemService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
