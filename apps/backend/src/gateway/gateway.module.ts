import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ServicesModule } from '../services/services.module';

/**
 * Entry points of the app (HTTP/WS controllers). No business logic here.
 */
@Module({
  imports: [ServicesModule],
  controllers: [HealthController],
})
export class GatewayModule {}
