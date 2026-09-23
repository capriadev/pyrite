import { Module } from '@nestjs/common';
import { HealthService } from './health/health.service';
import { RatesSchedulerService } from './rates-scheduler.service';
import { DisputesSchedulerService } from './disputes-scheduler.service';
import { LogRetentionSchedulerService } from './log-retention-scheduler.service';

@Module({
  providers: [HealthService, RatesSchedulerService, DisputesSchedulerService, LogRetentionSchedulerService],
  exports: [HealthService],
})
export class ServicesModule {}
