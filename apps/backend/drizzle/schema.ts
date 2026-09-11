import { jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

// ============================================================
// Finances
// ============================================================

export const movementTypeEnum = pgEnum('movement_type', ['income', 'expense']);
export const movementStatusEnum = pgEnum('movement_status', ['active', 'deleted']);
export const currencyEnum = pgEnum('currency', ['ARS', 'USD']);
export const balanceKeyEnum = pgEnum('balance_key', ['cash_ars', 'digital_ars', 'cash_usd', 'digital_usd']);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: movementTypeEnum('type').notNull(),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const platforms = pgTable('platforms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const balances = pgTable('balances', {
  key: balanceKeyEnum('key').primaryKey(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const movements = pgTable('movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: movementTypeEnum('type').notNull(),
  amountCurrency: currencyEnum('amount_currency').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  paidCurrency: currencyEnum('paid_currency').notNull(),
  paidAmount: numeric('paid_amount', { precision: 14, scale: 2 }).notNull(),
  rateUsed: numeric('rate_used', { precision: 14, scale: 4 }).notNull(),
  balanceSource: balanceKeyEnum('balance_source').notNull(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  platformId: uuid('platform_id').references(() => platforms.id),
  description: text('description').notNull(),
  note: text('note'),
  date: timestamp('date', { withTimezone: true }).notNull().defaultNow(),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Rates
// ============================================================

export const ratesDaily = pgTable('rates_daily', {
  type: text('type').notNull(),
  buy: numeric('buy', { precision: 10, scale: 2 }).notNull(),
  sell: numeric('sell', { precision: 10, scale: 2 }).notNull(),
  date: text('date').notNull(),
}, (t) => ({
  uniqueTypeDate: { name: 'rates_daily_type_date_key', columns: [t.type, t.date], unique: true },
}));

// ============================================================
// API keys
// ============================================================

export const validatorStatusEnum = pgEnum('validator_status', ['unchecked', 'valid', 'expired', 'invalid']);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  detail: text('detail'),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  salt: text('salt').notNull(),
  groupId: uuid('group_id').references(() => apiGroups.id, { onDelete: 'set null' }),
  status: movementStatusEnum('status').notNull().default('active'),
  validatorStatus: validatorStatusEnum('validator_status').notNull().default('unchecked'),
  lastChecked: timestamp('last_checked', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiGroups = pgTable('api_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
