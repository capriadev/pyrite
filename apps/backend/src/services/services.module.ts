import { Module } from '@nestjs/common';
import { HealthService } from './health/health.service';
import { RatesSchedulerService } from './rates-scheduler.service';

@Module({
  providers: [HealthService, RatesSchedulerService],
  exports: [HealthService],
})
export class ServicesModule {}
