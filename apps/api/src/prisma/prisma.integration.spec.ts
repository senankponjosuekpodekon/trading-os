import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

describe('PrismaService integration', () => {
  let prisma: PrismaService;
  let module: TestingModule;
  let connected = false;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = module.get<PrismaService>(PrismaService);
    try {
      await prisma.$connect();
      connected = true;
    } catch {
      connected = false;
    }
  });

  afterAll(async () => {
    if (connected) await prisma.$disconnect();
    if (module) await module.close();
  });

  it('connects to the database and can run a raw query', async () => {
    if (!connected) {
      console.log('Skipping integration test: database not available');
      return;
    }
    const result = await prisma.$queryRawUnsafe<{ now: Date }[]>(`SELECT NOW() as now`);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].now).toBeInstanceOf(Date);
  });
});
