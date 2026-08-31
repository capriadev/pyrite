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
 * Local defaults matching docker/docker-compose.yml. Real configuration
 * (including integration keys) will be loaded from the DB at boot in a
 * later spec; no .env files are used in Pyrite.
 */
export const appConfig: AppConfig = {
  port: 3001,
  db: {
    host: '127.0.0.1',
    port: 5433,
    user: 'pyrite',
    password: 'pyrite',
    database: 'pyrite',
  },
  redis: {
    host: '127.0.0.1',
    port: 6379,
  },
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export const appConfigProvider = {
  provide: APP_CONFIG,
  useValue: appConfig,
};
