import { Module } from '@nestjs/common';
import { HealthService } from './health/health.service';
import { RatesSchedulerService } from './rates-scheduler.service';
import { DisputesSchedulerService } from './disputes-scheduler.service';

@Module({
  providers: [HealthService, RatesSchedulerService, DisputesSchedulerService],
  exports: [HealthService],
})
export class ServicesModule {}
