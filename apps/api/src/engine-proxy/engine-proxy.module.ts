import { Module } from '@nestjs/common';
import { EngineProxyController } from './engine-proxy.controller';
import { EngineHttpModule } from '../engine/engine-http.module';

@Module({
  imports: [EngineHttpModule],
  controllers: [EngineProxyController],
})
export class EngineProxyModule {}
