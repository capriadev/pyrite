import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

export const REDIS = Symbol('REDIS');

class RedisHolder implements OnApplicationShutdown {
  constructor(readonly client: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}

const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Redis(config.redis),
    },
    RedisHolder,
    {
      provide: REDIS,
      useExisting: REDIS_CLIENT,
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
