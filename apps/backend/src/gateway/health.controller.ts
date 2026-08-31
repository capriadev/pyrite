import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from '../services/health/health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<unknown> {
    const report = await this.healthService.check();
    if (!this.healthService.isHealthy(report)) {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
