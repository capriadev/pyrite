import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DRIZZLE_DB, type DrizzleDb } from '../../dal/drizzle.provider';
import { REDIS } from '../../dal/redis.module';

export interface HealthReport {
  app: boolean;
  postgres: boolean;
  redis: boolean;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthReport> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    return { app: true, postgres, redis };
  }

  isHealthy(report: HealthReport): boolean {
    return report.postgres && report.redis;
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
