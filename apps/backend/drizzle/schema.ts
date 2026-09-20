import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

/**
 * Tree of folders/categories shared by every domain: roots have `parent_id` null and
 * any node can hold children, so `freelancer/clientes/cliente-x` is just three levels
 * of the same mechanism. Uniqueness is per level: two different parents can both have
 * a child called `clientes`, but the same name cannot repeat under the same parent.
 */
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => groups.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('groups_domain_root_name_key')
    .on(t.domain, t.name)
    .where(sql`parent_id is null`),
  uniqueIndex('groups_domain_parent_name_key')
    .on(t.domain, t.parentId, t.name)
    .where(sql`parent_id is not null`),
]);

// ============================================================
// Rotation (section passphrase change, spec 013)
// ============================================================

export const rotationStatusEnum = pgEnum('rotation_status', [
  'staging',
  'applying',
  'done',
  'failed',
  'interrupted',
]);

/**
 * One passphrase rotation per section. At most one open job per section
 * (unique partial index), so starting while a job is open resumes it instead
 * of piling up work. `pending_canary` is the canary of the new passphrase,
 * kept encrypted under it: it is what a resume verifies against. Progress
 * lives here so it survives a restart; the passphrases never do.
 */
export const rotationJobs = pgTable('rotation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  section: text('section').notNull(),
  status: rotationStatusEnum('status').notNull().default('staging'),
  total: integer('total').notNull().default(0),
  processed: integer('processed').notNull().default(0),
  pendingCanary: jsonb('pending_canary').$type<Record<string, unknown>>().notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('rotation_jobs_section_open_key')
    .on(t.section)
    .where(sql`status in ('staging', 'applying', 'interrupted')`),
]);

/**
 * Durable staging of the new ciphertexts. One row per write-back unit
 * (an account for counts, a note or api key row elsewhere), written
 * incrementally while staging and dropped on apply or cancel. Payload holds
 * the columns to write back, ciphertext included, never plaintext.
 */
export const rotationStaging = pgTable('rotation_staging', {
  jobId: uuid('job_id')
    .notNull()
    .references(() => rotationJobs.id, { onDelete: 'cascade' }),
  targetTable: text('target_table').notNull(),
  rowId: uuid('row_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  stagedAt: timestamp('staged_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({
    name: 'rotation_staging_pk',
    columns: [t.jobId, t.targetTable, t.rowId],
  }),
]);

// ============================================================
// Calendar / Tasks (spec 015)
// ============================================================

export const taskTypeEnum = pgEnum('task_type', ['puntual', 'recurrente', 'pago']);
export const taskStatusEnum = pgEnum('task_status', ['active', 'paused', 'deleted']);
export const frequencyUnitEnum = pgEnum('frequency_unit', ['day', 'week', 'month', 'year']);
export const recurrenceEndModeEnum = pgEnum('recurrence_end_mode', ['never', 'on_date', 'after_count']);
/** What an annual rule does when its day is February 29 and the year has no such day. */
export const leapDayModeEnum = pgEnum('leap_day_mode', ['feb28', 'mar01']);
export const paymentModeEnum = pgEnum('payment_mode', ['recurrente', 'cuotas', 'fija']);
/** Unit of the free trial: a month is a calendar month, not thirty days. */
export const trialUnitEnum = pgEnum('trial_unit', ['day', 'week', 'month']);
export const expectationStatusEnum = pgEnum('expectation_status', ['pending', 'settled', 'exception', 'cancelled']);
export const taskPriorityEnum = pgEnum('task_priority', ['baja', 'media', 'alta', 'critica']);
export const taskStateEnum = pgEnum('task_state', ['pendiente', 'en_progreso', 'completado', 'cancelado']);

/**
 * Loose sectors of a task (cliente, estudios, personal...). "Otro" in the form is a
 * sector created on the fly: it lands here and is offered next time, same idea as the
 * on-the-fly category of finances. A sector is a task field, not a tree node: the group
 * tree is structure, the sector is a classification.
 */
export const taskSectors = pgTable('task_sectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: movementStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('task_sectors_name_key').on(t.name),
]);

/**
 * Everything with a date is a task: a punctual event, a recurring activity or a
 * payment. Calendar owns no rows of its own - it reads and displays what tasks
 * computes (spec 015). Dates, titles and estimates only: no secret lives here,
 * so this domain has no crypto section and no passphrase gate.
 *
 * Spec 016 adds the organization layer: the group tree (`group_id`), the sector and the
 * fields of the ficha. `state` is what a kanban board renders, and both `priority` and
 * `state` are nullable on purpose: not everything has a priority, and a task without a
 * state simply does not appear in any board.
 */
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  icon: text('icon'),
  type: taskTypeEnum('type').notNull(),
  status: taskStatusEnum('status').notNull().default('active'),
  description: text('description'),
  notes: text('notes'),
  priority: taskPriorityEnum('priority'),
  state: taskStateEnum('state'),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
  sectorId: uuid('sector_id').references(() => taskSectors.id, { onDelete: 'set null' }),
  linkedExpectationId: uuid('linked_expectation_id').references((): AnyPgColumn => taskExpectations.id, { onDelete: 'set null' }),
  startsOn: date('starts_on').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One rule per recurring task: the frequency and how the series ends. */
export const taskRecurrence = pgTable('task_recurrence', {
  taskId: uuid('task_id').primaryKey().references(() => tasks.id, { onDelete: 'cascade' }),
  frequencyUnit: frequencyUnitEnum('frequency_unit').notNull(),
  interval: integer('interval').notNull().default(1),
  endsMode: recurrenceEndModeEnum('ends_mode').notNull().default('never'),
  endsOn: date('ends_on'),
  occurrencesCount: integer('occurrences_count'),
  /** Only meaningful on an annual rule: February 29 has no home in a common year. */
  leapDayMode: leapDayModeEnum('leap_day_mode').notNull().default('feb28'),
  /** Optional hour of the series (`HH:MM`); the weekly rule carries one per selected day. */
  time: text('time'),
  timeTo: text('time_to'),
});

/**
 * Ordered price tiers of a payment task. The amount is an estimate for the
 * preview, never an authority: finance (spec 005) holds the real amounts.
 * `applies_from_occurrence` is the 1-based occurrence where the tier takes
 * over, which is how a promo ($1000) becomes a regular price ($2500).
 */
export const taskPriceTiers = pgTable('task_price_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }),
  currency: currencyEnum('currency').notNull().default('ARS'),
  appliesFromOccurrence: integer('applies_from_occurrence').notNull().default(1),
}, (t) => [
  unique('task_price_tiers_task_position_key').on(t.taskId, t.position),
]);

/**
 * Financial payload of a payment task: mode, the optional price (fixed or
 * variable), the trial that delays the first charge and the installment count
 * of a finite series. A price-less payment is a variable service (rent,
 * utilities): its expectations carry dates only until finance fills them.
 */
export const taskPayments = pgTable('task_payments', {
  taskId: uuid('task_id').primaryKey().references(() => tasks.id, { onDelete: 'cascade' }),
  mode: paymentModeEnum('mode').notNull(),
  priceFixed: boolean('price_fixed').notNull().default(false),
  priceAmount: numeric('price_amount', { precision: 14, scale: 2 }),
  priceCurrency: currencyEnum('price_currency').notNull().default('ARS'),
  /** Free trial: a quantity plus its unit (`day` | `week` | `month`), zero meaning none. */
  trialCount: integer('trial_count').notNull().default(0),
  trialUnit: trialUnitEnum('trial_unit').notNull().default('day'),
  installmentsCount: integer('installments_count'),
});

/**
 * Materialized expectations: the occurrences of a task with a stable id, so the
 * reconciliation of 018 has something to point at. A payment without price
 * leaves `estimated_amount` null on purpose: the system never invents a value.
 */
export const taskExpectations = pgTable('task_expectations', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  expectedOn: date('expected_on').notNull(),
  estimatedAmount: numeric('estimated_amount', { precision: 14, scale: 2 }),
  currency: currencyEnum('currency'),
  tierPosition: integer('tier_position'),
  /** Time of day (`HH:MM`) and optional end of a range: metadata the detail view reads. */
  scheduledTime: text('scheduled_time'),
  timeTo: text('time_to'),
  /** Free label of a punctual entry ("con Nico", "turno 3"): the multiple format uses it. */
  label: text('label'),
  status: expectationStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('task_expectations_task_date_key').on(t.taskId, t.expectedOn),
]);

/**
 * Dated entries of a punctual task (spec 017). One row is the simple format (start and end
 * date plus an hour), and N rows are the multiple format: loose dates, each with its own
 * optional hour, hour range and label. A range shows on every day it covers.
 */
export const taskDates = pgTable('task_dates', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  dateTo: date('date_to'),
  time: text('time'),
  timeTo: text('time_to'),
  label: text('label'),
}, (t) => [
  unique('task_dates_task_date_key').on(t.taskId, t.date),
]);

/**
 * Selected weekdays of a weekly rule, each with its own optional hour: a single hour among
 * the rows acts as the global one for the days that do not carry their own.
 */
export const taskWeekdays = pgTable('task_weekdays', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  /** ISO day of the week: 1 is Monday, 7 is Sunday. */
  weekday: integer('weekday').notNull(),
  time: text('time'),
  timeTo: text('time_to'),
}, (t) => [
  unique('task_weekdays_task_weekday_key').on(t.taskId, t.weekday),
]);
