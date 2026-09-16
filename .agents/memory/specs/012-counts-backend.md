# 012 Counts backend

Status: completed (merged in PR #16; change-passphrase delivered by 013).

## Objective
Build the Counts backend: a zero-knowledge credential vault with per-record encryption
(heavy Argon2id profile), password history, strength scoring, duplicate detection and
OAuth-account linking. Metadata stays in plaintext so search and card rendering work
without unlock; only sensitive values are encrypted and revealed per explicit action.

## Scope
- In scope:
  - `counts_accounts` table: plaintext metadata (name, kind, url, email, username,
    number, notes, credential type, OAuth flag) plus encrypted columns (password,
    secret value, security phrase, 2FA backup codes, security questions).
  - `counts_password_history` table: encrypted previous passwords with the date they
    were replaced; prior password is never overwritten on change.
  - `counts_account_groups` join table: many-to-many categorization reusing the shared
    `groups` table with `domain: 'counts'` (an account can carry several tags).
  - Encryption with the `counts` section passphrase (heavy profile, per-record salt,
    AAD bound to the record id).
  - Password strength score persisted as plaintext metadata (computed while the
    plaintext is in memory on save).
  - Endpoints: accounts CRUD (soft delete), reveal (per account or per field), history,
    weak-account audit, duplicate audit, group CRUD, passphrase change with re-encryption.
  - `oauth` credentials reference an OAuth-enabled account (self-FK), so a future
    linking select can list them.
- Out of scope:
  - UI (frontend comes later; the v1 card layout is documented here as the contract).
  - Password generator runtime (frontend-side; rules live in settings).
  - Automatic rotation of anything (passphrases or peppers) - decided against, see
    "Decisions".

## Access matrix (the contract v1 defines)

Metadata and indicators are readable without unlocking; secrets require an explicit
unlock and an explicit reveal action.

| Action | Unlock required |
|---|---|
| List cards with metadata (name, url, user, email, number, notes, date, tags) | No |
| Search (name, site, user, email, notes) and filters | No |
| See indicators (OAuth, OAuth source, 2FA, phrase) and totals | No |
| Copy metadata (url, user, email) | No |
| Reveal or copy password, phrase, 2FA codes, security questions | Yes |
| Create, edit, delete | Yes |

Indicators are derived from the presence of an encrypted column (ciphertext exists or
not), so no decryption is needed to render a card.

## Approach
- Encryption: heavy profile from `crypto-config` (`CRYPTO_PROFILE_HEAVY_*`,
  `SHARED_SALT=false`), own pepper `CRYPTO_COUNTS_PEPPER`. Each account stores its own
  salt per encrypted column; AAD is the account id. Decrypt only on reveal and on the
  audits/history, never while building the list.
- Column-per-secret instead of a single blob: v1 reveals field by field (an eye on the
  password, an eye on the phrase) and derives badges from existence; separate columns map
  directly to that and let strength operate on `password` only.
- Notes inside an account are plaintext metadata, same as name/url/user/email (confirmed
  with the user): they are a clarifying detail, not a secret.
- History: when an edit carries a new password, the prior value is encrypted into
  `counts_password_history` with `changed_at`, then the account row is updated. The old
  password is never overwritten in place.
- Strength: computed on save while the plaintext is available, stored as a plaintext
  score; the weak audit reads the persisted score (no brute force of the vault).
- Duplicates: on demand, decrypts every stored password in memory (skipping OAuth
  accounts without their own password) and groups equal values. Nothing derived is
  persisted - no comparison hashes in the database.
- OAuth: `oauth_enabled` marks an account usable as an identity source;
  `oauth_src_account_id` is a self-FK used by `oauth`-type credentials to point at it.
- Groups: delegated to the shared `GroupsService` with `domain: 'counts'`, same as
  notes and apis.
- Passphrase change: `POST /auth/change-passphrase/:section` requires the current
  passphrase plus the new one, verifies the old against the canary, re-encrypts every
  encrypted record of the section inside a transaction, writes the new canary last, and
  only then commits. Started in the background with progress reporting; an interruption
  leaves the previous passphrase fully working.

## Decisions (recorded so they are not re-litigated)
- **No recovery, ever.** Losing the passphrase loses the vault. Any change path that does
  not require the current passphrase would be recovery in disguise and would break the
  zero-knowledge model. Change always needs old + new in the same request.
- **A third party without the passphrase cannot rotate it** (401 on change). A third
  party with the passphrase already had full access; rotation grants no new power.
  Someone editing the canary row in the DB locks the user out but cannot read data
  (records stay encrypted under the user's derived key).
- **No automatic passphrase rotation.** The system would have to persist the generated
  passphrase, which is exactly what zero-knowledge forbids.
- **No automatic pepper rotation.** The pepper protects against "DB stolen, `.env` not".
  Rotating on a schedule defends no new scenario, requires persisting the new pepper
  (defeating its purpose) or rewriting the `.env`, and an unattended process rewriting
  the crypto base of a no-recovery vault is an unacceptable risk. Suspected `.env`
  exposure is a manual procedure: rotate pepper + passphrase + re-encrypt now.
- **No cron for credential rotation.** `last_password_changed_at` plus a settings
  threshold drives a "rotar credenciales" reminder (badge per account and an aggregate
  panel). Rotating a stored password means logging into that site, so it cannot be
  automated; it is a manual flow that this section already supports.
- **Staleness threshold is app config** (settings table, adjustable from the UI), not
  `.env` (infra only).

## Data model (migration 0006)

`counts_accounts`:
- Plaintext: `id`, `name`, `kind`, `url`, `email`, `username`, `number`, `notes`,
  `credential_type`, `oauth_enabled`, `oauth_src_account_id`, `status`, `strength_score`,
  `last_password_changed_at`, `salt`, `created_at`, `updated_at`.
- Encrypted (each with its own `ciphertext`/`iv`/`auth_tag`): `password`, `secret_value`,
  `phrase`, `twofa_codes`, `security_questions`.

Salt granularity: **one salt per account**, not per column. With the heavy profile
(128 MB, t=4) five derivations per save/reveal would be unusable; deriving once per
account and reusing the key across its five columns keeps one KDF per row. The
anti-swap property is preserved by binding the AAD to `${id}:${field}` instead of the
bare id, so a ciphertext moved to another column or row fails authentication.

`counts_password_history`: `id`, `account_id` (FK, cascade), encrypted password columns
plus its own `salt`, `changed_at`.

`counts_account_groups`: `account_id` (FK, cascade), `group_id` (FK to shared `groups`,
cascade) - composite primary key. Many-to-many: v1 shows accounts carrying several tags
(`# MAILS` next to `OAuth src`).

`oauth_src_account_id` is a nullable self-FK (set null on delete) used by credentials of
type `oauth` to point at the OAuth-enabled account they belong to.

## Endpoints

```
GET    /counts                     list + search + filters (no unlock, no secrets)
GET    /counts/:id                 single account metadata (no unlock)
POST   /counts                     create (unlock)
PUT    /counts/:id                 edit (unlock; password change moves history)
PUT    /counts/:id/groups          replace the account's tags (unlock)
DELETE /counts/:id                 soft delete (unlock)
GET    /counts/:id/reveal          all decrypted fields of one account (unlock)
GET    /counts/:id/history         decrypted password history (unlock)
GET    /counts/audit/weak          accounts at or below the threshold (unlock)
GET    /counts/audit/duplicates    groups of accounts sharing a password (unlock)
GET    /counts/groups              list groups (metadata, no unlock)
POST   /counts/groups              create group
DELETE /counts/groups/:id          soft delete group
POST   /auth/change-passphrase/:section   rotate passphrase + re-encrypt (unlock)
```

## Acceptance criteria
- [x] Migration 0006 creates `counts_accounts`, `counts_password_history` and
      `counts_account_groups` without touching existing data.
      (Applied 2026-09-14; existing rows preserved: 7 notes, 8 settings, 2 groups.)
- [ ] Listing/search return metadata only (no secret columns) with derived indicators,
      while the section is locked.
- [ ] Reveal endpoints return decrypted values only while the `counts` section is
      unlocked; otherwise 403.
- [ ] Editing a password moves the previous value into history with its date.
- [ ] Strength score is persisted on save and the weak audit returns accounts at or
      below the configured threshold.
- [ ] Duplicate audit groups accounts sharing a password and excludes OAuth accounts
      without their own password; nothing derived is persisted.
- [ ] Groups work through the shared service and stay isolated by domain.
- [ ] `POST /auth/change-passphrase/:section` re-encrypts and swaps atomically; a
      failure leaves the old passphrase working.
- [ ] `npm run tsc` passes (strict) and no secret value or passphrase reaches the logs.
