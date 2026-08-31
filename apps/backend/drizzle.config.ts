import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: '127.0.0.1',
    port: 5433,
    user: 'pyrite',
    password: 'pyrite',
    database: 'pyrite',
  },
  strict: true,
  verbose: true,
});
