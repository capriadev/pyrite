import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Pyrite database schema. Source of truth for drizzle-kit.
 * Tables are added per-feature specs; never edited outside the
 * pyrite-orm flow (tsc -> orm -> review .sql -> orm:migrate).
 */

/**
 * System settings, loaded into memory at boot and mutated at runtime.
 * Namespaced keys, e.g. 'agent.provider', 'ui.theme'. The user-facing
 * config that lives in the DB (provider/api-keys/UI prefs) - NOT infra.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
