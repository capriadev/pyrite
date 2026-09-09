import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import * as schema from '../../drizzle/schema';
import { DRIZZLE_DB, type DrizzleDb } from './drizzle.provider';
import { SettingsRepository } from './settings/settings.repository';
import { FinancesRepository } from './finances/finances.repository';
import { RatesRepository } from './rates/rates.repository';
import { ApiKeysRepository } from './apis/api-keys.repository';

class PgPoolHolder implements OnApplicationShutdown {
  constructor(readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({
          host: config.db.host,
          port: config.db.port,
          user: config.db.user,
          password: config.db.password,
          database: config.db.database,
        }),
    },
    {
      provide: DRIZZLE_DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): DrizzleDb => drizzle(pool, { schema }),
    },
    PgPoolHolder,
    SettingsRepository,
    FinancesRepository,
    RatesRepository,
    ApiKeysRepository,
  ],
  exports: [DRIZZLE_DB, SettingsRepository, FinancesRepository, RatesRepository, ApiKeysRepository],
})
export class DalModule {}

