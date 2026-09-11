import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 30010),
    user: process.env.DB_USER ?? 'pyrite',
    password: process.env.DB_PASSWORD ?? 'pyrite',
    database: process.env.DB_NAME ?? 'pyrite',
  },
  strict: true,
  verbose: true,
});
