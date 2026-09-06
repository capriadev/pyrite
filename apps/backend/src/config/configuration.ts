import 'dotenv/config';

export interface AppConfig {
  port: number;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  redis: {
    host: string;
    port: number;
  };
}

/**
 * Backend infrastructure config, read from the backend .env with local
 * defaults for dev. The Pyrite port block is 30xxx (prod 30000-30019,
 * test/other 301xx).
 */
export const appConfig: AppConfig = {
  port: Number(process.env.BACKEND_PORT ?? 30001),
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 30010),
    user: process.env.DB_USER ?? 'pyrite',
    password: process.env.DB_PASSWORD ?? 'pyrite',
    database: process.env.DB_NAME ?? 'pyrite',
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 30011),
  },
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export const appConfigProvider = {
  provide: APP_CONFIG,
  useValue: appConfig,
};
