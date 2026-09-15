import {
  foreignKey,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

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
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
  status: movementStatusEnum('status').notNull().default('active'),
  validatorStatus: validatorStatusEnum('validator_status').notNull().default('unchecked'),
  lastChecked: timestamp('last_checked', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Notes
// ============================================================

export const notesPrivateEnum = pgEnum('notes_private_flag', ['true', 'false']);
export const notesPinnedEnum = pgEnum('notes_pinned_flag', ['true', 'false']);

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  salt: text('salt').notNull(),
  isPrivate: notesPrivateEnum('is_private').notNull().default('false'),
  pinned: notesPinnedEnum('pinned').notNull().default('false'),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Counts - credential vault (spec 012).
 * Metadata stays plaintext (searchable and renderable without unlock);
 * only sensitive values are encrypted, each with its own salt, AAD = row id.
 */

export const credentialTypeEnum = pgEnum('credential_type', ['password', 'oauth', 'sso', 'api_key', 'other']);

export const countsAccounts = pgTable('counts_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind'),
  url: text('url'),
  email: text('email'),
  username: text('username'),
  number: text('number'),
  notes: text('notes'),
  credentialType: credentialTypeEnum('credential_type').notNull().default('password'),
  oauthEnabled: notesPrivateEnum('oauth_enabled').notNull().default('false'),
  oauthSrcAccountId: uuid('oauth_src_account_id'),
  status: movementStatusEnum('status').notNull().default('active'),
  strengthScore: numeric('strength_score', { precision: 4, scale: 1 }),
  lastPasswordChangedAt: timestamp('last_password_changed_at', { withTimezone: true }),
  /**
   * One salt per account: the heavy KDF runs once per account and the resulting
   * key encrypts every secret column of that row. AAD is `${id}:${field}` so a
   * ciphertext cannot be swapped between columns or rows.
   */
  salt: text('salt').notNull(),
  passwordCiphertext: text('password_ciphertext'),
  passwordIv: text('password_iv'),
  passwordAuthTag: text('password_auth_tag'),
  secretValueCiphertext: text('secret_value_ciphertext'),
  secretValueIv: text('secret_value_iv'),
  secretValueAuthTag: text('secret_value_auth_tag'),
  phraseCiphertext: text('phrase_ciphertext'),
  phraseIv: text('phrase_iv'),
  phraseAuthTag: text('phrase_auth_tag'),
  twofaCiphertext: text('twofa_ciphertext'),
  twofaIv: text('twofa_iv'),
  twofaAuthTag: text('twofa_auth_tag'),
  questionsCiphertext: text('questions_ciphertext'),
  questionsIv: text('questions_iv'),
  questionsAuthTag: text('questions_auth_tag'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: 'counts_accounts_oauth_src_fkey',
    columns: [t.oauthSrcAccountId],
    foreignColumns: [t.id],
  }).onDelete('set null'),
]);

export const countsPasswordHistory = pgTable('counts_password_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => countsAccounts.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  salt: text('salt').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const countsAccountGroups = pgTable('counts_account_groups', {
  accountId: uuid('account_id')
    .notNull()
    .references(() => countsAccounts.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({
    name: 'counts_account_groups_pk',
    columns: [t.accountId, t.groupId],
  }),
]);

// ============================================================
// Groups (unified per-domain)
// ============================================================

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull(),
  name: text('name').notNull(),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('groups_domain_name_key').on(t.domain, t.name),
]);
