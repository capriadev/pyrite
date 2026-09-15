# 013 Section passphrase rotation

Status: active (branch feat/section-key-rotation).

## Objective
Rotate the passphrase of any section (`notes`, `notes_private`, `apis`, `vault`, `counts`)
in the background: the new ciphertexts are staged while the live data keeps being read with the
old passphrase, and the change is applied at the end in one atomic swap of the canary.
Interruptions resume and failures roll back, so at any instant the whole section answers to
either the old passphrase or the new one, never to a mix. While the job is open the section is
read-only: viewing keeps working and create/edit/delete are rejected until it finishes or is
cancelled. No recovery, ever: rotation always requires the current passphrase plus the new one
in the same request (012).

## Current state (pre-check before this spec)
Four different key models coexist today, which is what makes one single rotation path
non-trivial:

| Section | What is encrypted | Salt model | Derivation | Cache |
|---|---|---|---|---|
| `notes` | content of the public note rows | section salt in settings (`notes.salt`, light profile) | one derivation for the whole section | `NotesService.sectionKeys` |
| `notes_private` | content of the private note rows (same table) | section salt in settings (`notes_private.salt`, medium) | one derivation for the whole section, own passphrase | `NotesService.sectionKeys` |
| `apis` | API key value | own salt per record (`api_keys.salt`) | one derivation per row on every read | none |
| `counts` | 5 secret column sets of an account + each history row | salt per account, and own salt per history row (heavy profile) | one derivation per account, one per history row | none |
| `vault` | nothing (section name exists, no table) | - | - | - |
| canary (`${section}.canary`) | `__PYRITE_CANARY__` | own random salt per canary | verification only | passphrase in `AuthService` |

Notes is one domain in the UI, not two: one list of notes, and private ones are simply not in
it - a separate "private/secure notes" view unlocks with its own passphrase and then shows its
content. The private flag is what routes a row to the `notes_private` key, so both sections
share the table but not the passphrase, and each one derives a single key for all of its rows.
Title, dates and the private flag stay readable while locked (010); only the content sits behind
the passphrase, which is what lets the UI list and search private notes by title and date.

Facts read from the crypto path that define the write-back of the rotation:
- The canary salt is issued by `CryptoService.createCanary` and only used by `verifyCanary`:
  it is independent from data salts, so a rotation can issue a new canary without touching
  data salts.
- `CryptoService.decrypt` ignores `EncryptedData.salt`; only key, `iv`, `authTag` and the AAD
  matter. Re-encryption is therefore "new key + new iv/authTag"; salt storage stays as is.
- `notes.salt` on a row is a copy of the derived key, not a salt: part of the shared-salt
  design of notes (one key for the whole section), unused in the decrypt path (recorded as
  is, see Decisions).
- `AuthService` keeps the passphrase (not the key) in memory with a 5 minute TTL, so a
  rotation swaps the stored passphrase and the next unlock verifies against the new canary.
- `NotesService.sectionKeys` caches a derived key per section without binding it to the
  passphrase that produced it: after a rotation it would keep encrypting with the previous
  key (a passphrase change does not clear the cache). Defect fixed by this spec.
- `POST /auth/set-passphrase/:section` refuses when the section already has a canary (409,
  "use change-passphrase"); `POST /auth/change-passphrase/:section` does not exist yet even
  though 012 lists it.

## Scope
- In scope:
  - `POST /auth/change-passphrase/:section` (start and resume), `GET .../status` (progress)
    and `POST .../cancel` (rollback), for the five sections.
  - One shared module for section-key primitives (salt model, derivation, cache) used by
    notes, apis, counts and the rotation, so there is one model instead of four.
  - Durable staging of the new ciphertexts plus the per-section write-back and the canary
    swap, applied at the end in one transaction.
  - Resume after an interruption and rollback on cancel or failure.
  - Cache invalidation so no service can encrypt with a previous key.
  - Migration 0007: `rotation_jobs` and `rotation_staging`.
- Out of scope:
  - Pepper rotation (decided against in 012; manual procedure documented there).
  - Rotating data salts: only the passphrase (and therefore the key) changes.
  - Automatic or scheduled rotation (would require storing the passphrase: forbidden).
  - UI.

## Approach - staged in the background, applied atomically at the end
The job is durable, the passphrase is not. Every step below respects that: progress survives a
restart, secrets do not survive the process.
1. Start (synchronous, guards only): valid section; section configured (canary exists, else
   409); section unlocked (else 401); `current` verified against the live canary (else 401);
   `next` validated and different from `current` (else 400). If the section already has a job
   running or interrupted, that call resumes it instead of starting a new one (`next` is then
   verified against the pending canary).
2. Stage (background, the long phase): walk the rows of the section one by one, decrypt with
   the current key, encrypt with a key derived from `next`, and persist the result as a staged
   row. Live data is untouched, so the old passphrase keeps working for the whole phase. Each
   staged row is durable, and that is what makes progress survive a restart.
3. Apply (short transaction, the atomic point): write the new canary, copy every staged row
   into its live columns, mark the job done, commit. Postgres makes this all or nothing: after
   a blackout the section is either fully old or fully new, never mixed.
4. Cleanup: drop the staged rows and the job, evict every key cache tied to the previous
   passphrase. The section stays unlocked under `next`.
5. Cancel or failure: mark the job failed and drop the staged rows. Nothing was applied, so the
   old passphrase keeps working; staged rows are disposable by design.

Recovery rules (what happens after an interruption):
- A job left `staging` when the process died is surfaced as `interrupted` with its progress on
  the next start. Staged rows are still valid; resuming needs both passphrases again (they are
  never stored) and verifies `next` against the pending canary.
- A job left `applying` is decided by the live canary: matching `next` means the swap
  committed (finish the cleanup), matching `current` means it did not (staged rows remain,
  resumable or cancellable).
- Staged rows written under a passphrase the user no longer wants are simply discarded: cancel
  is the rollback, and it cannot lose data because nothing live was ever modified.
- If the passphrases disappear mid-staging (section locked, 5 minute unlock TTL expired, process
  restarted), staging pauses instead of failing: the staged rows are durable, so the job stays
  open and is surfaced as needing resume until it is resumed with both passphrases or cancelled.

## Decisions (recorded so they are not re-litigated)
- **Background with durable staging, applied at the end in one atomic swap.** This replaces
  012's "re-encrypt ... inside a transaction" plus "background with progress reporting" pair,
  which cannot both hold (a write transaction held open through the whole KDF/decrypt work
  could not be observed for progress). Staging keeps the live section readable with the old
  passphrase until the swap, and the swap is one short transaction, so even a blackout lands
  on a consistent state.
- **Resume and rollback are both required: they answer different situations.** Resume covers an
  interruption (the work was fine, the process died) and reuses the staged rows; rollback
  covers cancel or failure and drops them, without touching live data. Neither alone is enough:
  rollback-only throws away a long phase for nothing, resume-only cannot clean up a job nobody
  wants anymore.
- **The section is read-only while a job is open** (viewing keeps working; create, edit and
  delete answer 409 with the job status). A row created or edited during staging would not be
  in the staged set, so the apply would leave it encrypted with the old key and unreadable with
  the new passphrase. Blocking writes is the cheap correct fix for a single-user operation that
  lasts moments to minutes; the alternative (re-stage at apply every row touched since the
  snapshot) adds bookkeeping with no real gain. The frontend turns that 409 into "rotation in
  progress, retry" and can poll the status endpoint.
- **The job is durable, the passphrase is not.** Progress lives in `rotation_staging`. Resuming
  asks for both passphrases again (single-user, manual, rare operation) and verifies `next`
  against the pending canary, so no passphrase or key is ever persisted and zero-knowledge is
  untouched. While a job is actively staging it holds both in memory (never on disk), which is
  why the unlock TTL does not govern it: losing them pauses the job, only a resume re-supplies
  them, and a lock does not have to wait for the staging to end.
- **The pending canary is stored with the job**, encrypted under `next`: the same
  `__PYRITE_CANARY__` mechanism used by unlock, reused as the resume verifier. The live canary
  changes only in the apply transaction.
- **The live canary is the commit marker** (kept from 012): while it is unchanged the section is
  fully readable with the old passphrase, and after the apply commits the new one is the only
  key that works.
- **Staging is payload-generic** (`target_table` + jsonb, one row per write-back unit) so the
  machinery is not repeated per section: the future `vault`/cloud section only registers a
  rotator.
- **The passphrase is never stored, only the canary.** Rotation replaces the canary; there is
  no passphrase history and no recovery path (012).
- **Salt is not rotated, only the passphrase.** Data salts stay (shared per section for notes,
  per record for apis, per account and per history row for counts): keys change because the
  passphrase changes and nothing else about storage changes.
- **`notes.salt` (row copy of the section key) is refreshed by the rotation** so the row stops
  pointing at the previous key. It keeps its current semantics: part of the shared-salt design
  of notes (one key for the whole section), out of the decrypt path.
- **`vault` is a valid target with no data**: rotation is canary-only, not an error.
- **The section stays unlocked under the new passphrase** after a successful rotation, and
  `AuthService` swaps its stored passphrase from `current` to `next`: with caches keyed by
  passphrase there is no stale-key window and the user is not kicked out of the section they
  just rotated (leaving the old passphrase there would make the next operation in the session
  encrypt with a dead key).
- **Sections rotate independently**: `notes` and `notes_private` have their own passphrases and
  their own rotation calls (010), even though the UI presents notes as one section with a
  separate private view. A `notes` rotation does not touch private rows and vice versa; if the
  UI wants a single action for notes, it calls both sections (UI decision, not backend).
- **Extracting the shared key primitives belongs to this spec, not to a follow-up**: the
  rotation needs one key model per section, and leaving four parallel derivations would give
  the rotation four code paths to keep in sync (rule: no two parallel systems per domain).

## Data model (migration 0007)
The work unit of each section, and what the apply step writes back:

| Section | Work unit (one derivation each) | Rows | What the apply writes back |
|---|---|---|---|
| `notes` | 1 derivation for the whole section (shared salt): it shares everything, so all of its rows go in one pass | public note rows | `ciphertext`/`iv`/`auth_tag` per row + `salt` (section key copy) |
| `notes_private` | 1 derivation for the whole section (shared salt) | private note rows | same |
| `apis` | 1 derivation per record (own salt per row) | `api_keys` | `ciphertext`/`iv`/`auth_tag` per row, salt untouched |
| `counts` | 1 heavy derivation per account (its signature mode), plus 1 per history row (own salt) | `counts_accounts`, `counts_password_history` | the 5 secret column sets per account; `ciphertext`/`iv`/`auth_tag` per history row; salts untouched |
| `vault` | none | none | canary only, nothing to stage |

`counts` is the only section whose unit is the account instead of the row: an account payload
carries its five secret column sets together, which is what "account by account, heavy" means
for its rotation cost.

`${section}.canary` in settings is replaced for every section (new random salt, new canary).

Migration 0007 adds machinery only, no domain table changes:
- `rotation_jobs`: `id`, `section`, `status` (`staging` | `applying` | `done` | `failed` |
  `interrupted`), `total`, `processed`, `pending_canary`, `error`, `created_at`, `updated_at`.
  At most one open job per section (unique partial index over `section`).
- `rotation_staging`: `job_id` (FK, cascade), `target_table`, `row_id`, `payload` (jsonb with
  the columns to write back, ciphertext included, never plaintext), `staged_at`. Written
  incrementally while staging; emptied on apply or cancel.

## Endpoints
```
POST /auth/change-passphrase/:section
body: { current: string, next: string }
202: { jobId, status: 'staging', total }     // started, or resumed when a job was open
200: { ok: true, section, staged: 0 }        // nothing to stage (vault): applied inline
400: invalid section, invalid/too short next, next === current
401: section locked, or current does not match the live canary (or next the pending one)
409: section has no canary configured (POST /auth/set-passphrase/:section is the one to use)

GET /auth/change-passphrase/:section/status
200: { status, total, processed, error? }    // status 'interrupted' after a restart

POST /auth/change-passphrase/:section/cancel
200: { ok: true, discarded: number }         // rollback: drops staged rows and the job
409: nothing to cancel (no open job)
```
The routes live in the auth gateway because the URLs come from 012; the controller validates
only the body shape and delegates everything to the rotation service.

## Files (planned)
- `apps/backend/src/services/crypto/section-keys.ts` (new): salt model per section,
  derivation, cache keyed by (section, passphrase).
- `apps/backend/src/bll/rotation/rotation.service.ts` (new): job state machine (start, stage,
  apply, cancel, recovery) and registry of per-section rotators.
- `apps/backend/src/bll/rotation/section-rotator.ts` (new): rotator contract (work units to
  stage, key derivation, write-back on apply).
- `apps/backend/src/dal/rotation/rotation.repository.ts` (new): job and staging access,
  including the apply transaction.
- `notes.service.ts`, `api-keys.service.ts`, `counts.service.ts`: implement the rotator and
  delegate derivation to the shared module; the `NotesService` cache becomes passphrase-keyed.
- `dal/drizzle.provider.ts`: tx-scoped helper so the apply step runs in one transaction.
- `gateway/auth/auth.controller.ts`: the three routes.
- `apps/backend/drizzle/migrations/0007_*`: `rotation_jobs` and `rotation_staging`.

## Acceptance criteria
- [ ] Rotating each of the five sections finishes and every record is still readable with the
      new passphrase (list, reveal and history).
- [ ] During the whole staging phase the live data keeps answering to the old passphrase; it
      stops only once the apply transaction commits.
- [ ] Status reports progress while staging, and `interrupted` after a restart with an open job.
- [ ] Locking the section (or letting the unlock TTL expire) pauses the job instead of failing it,
      and resuming with both passphrases continues and finishes it.
- [ ] Killing the process mid-staging and resuming with both passphrases completes the
      rotation; cancelling instead leaves the old passphrase working and no staged rows behind.
- [ ] A failure during staging rolls back: the old passphrase works and no live row changed.
- [ ] A blackout during apply is all or nothing: after the restart the section is fully old or
      fully new, and the live canary matches the data.
- [ ] Wrong `current` returns 401 with no change; unconfigured section 409; `next === current`
      400; cancel with no open job 409.
- [ ] While a job is open, writing to the section (create, edit, delete) answers 409 and reading
      keeps working; once the job finishes or is cancelled, writes work again under `next`.
- [ ] `vault` applies inline and reports nothing to stage.
- [ ] After a rotation nothing can encrypt with the previous key (passphrase-keyed cache) and
      the `notes.salt` copies hold the new key.
- [ ] Row counts per domain table are identical before and after; `rotation_jobs` and
      `rotation_staging` end empty.
- [ ] No passphrase, key or plaintext reaches the logs or the staging payloads (011 redaction).
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)
- `npx tsc -p apps/backend/tsconfig.json --noEmit` plus `npm run build` (CI parity).
- Smoke against dev: rotate `notes` (one pass for the section) and `counts` (account by
  account, heavy) while watching the status endpoint; then unlock with the old passphrase
  (expect 401) and with the new one (expect 200) and read every record (list, reveal, history).
- Interruption: kill the process mid-staging (dev only), restart, confirm the job shows
  `interrupted`, resume with both passphrases and finish; repeat and cancel instead, confirming
  nothing staged remains and the old passphrase still works.
- Read-only window: with a job open, a create, edit or delete against the section must answer
  409 while the reads keep working, and writing works again after the apply commits.
- Failure injection during staging (temporary throw in dev, removed afterwards): rollback
  leaves no live row changed.
- Blackout during apply: stop the container between staging and apply and verify the section is
  fully old or fully new with the canary matching the data.
- Row counts per domain table before and after, plus a check that a previous ciphertext no
  longer decrypts (proves the re-encryption actually happened).
