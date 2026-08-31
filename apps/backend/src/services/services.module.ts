import { Module } from '@nestjs/common';
import { HealthService } from './health/health.service';

/**
 * Cross-cutting application services (shared by bll and gateway).
 */
@Module({
  providers: [HealthService],
  exports: [HealthService],
})
export class ServicesModule {}
