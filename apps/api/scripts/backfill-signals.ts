import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SignalTrackerService } from '../src/signals/signal-tracker.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tracker = app.get(SignalTrackerService);
  await tracker.processActiveSignals();
  await app.close();
  console.log('Backfill terminé');
}
run().catch(console.error);
