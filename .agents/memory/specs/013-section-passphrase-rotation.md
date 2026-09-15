# 013 Section passphrase rotation

Status: active (branch feat/section-key-rotation).

## Objective
Rotate the passphrase of any section (`notes`, `notes_private`, `apis`, `vault`, `counts`)
without losing data: every encrypted record of that section is re-encrypted under the new
passphrase and the canary is swapped last, so an interrupted rotation leaves the old
passphrase fully working. No recovery, ever: rotation always requires the current passphrase
plus the new one in the same request (012).

## Current state (pre-check before this spec)
Four different key models coexist today, which is what makes one single rotation path
non-trivial:

| Section | What is encrypted | Salt model | Derivation | Cache |
|---|---|---|---|---|
| `notes` | note content | section salt in settings (`notes.salt`, light profile) | one key per section | `NotesService.sectionKeys` |
| `notes_private` | private note content | section salt in settings (`notes_private.salt`, medium) | one key per section, own passphrase | `NotesService.sectionKeys` |
| `apis` | API key value | own salt per record (`api_keys.salt`) | one derivation per row on every read | none |
| `counts` | 5 secret column sets of an account + each history row | salt per account, and own salt per history row (heavy profile) | one derivation per account, one per history row | none |
| `vault` | nothing (section name exists, no table) | - | - | - |
| canary (`${section}.canary`) | `__PYRITE_CANARY__` | own random salt per canary | verification only | passphrase in `AuthService` |

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
  - `POST /auth/change-passphrase/:section` for the five sections.
  - One shared module for section-key primitives (salt model, derivation, cache) used by
    notes, apis, counts and the rotation, so there is one model instead of four.
  - Per-section write-back of re-encrypted rows plus the canary swap, in one transaction.
  - Cache invalidation so no service can encrypt with a previous key.
- Out of scope:
  - Pepper rotation (decided against in 012; manual procedure documented there).
  - Background execution with progress reporting (see Decisions).
  - Schema changes: no migration in this spec.
  - Automatic or scheduled rotation (would require storing the passphrase: forbidden).
  - UI.

## Approach - "prepare, then swap"
1. Guards: valid section; section configured (canary exists, else 409); section unlocked
   (else 401); `current` verified against the canary (else 401); `next` validated and
   different from `current` (else 400).
2. Prepare, outside any transaction: read every row of the section, decrypt with the current
   key(s), derive the new key(s) and encrypt again, all in memory. Nothing is written yet.
   Cost to keep in mind: heavy-profile derivation per account and per history row, and every
   plaintext of the section in memory while it runs (single-user, manual, rare operation).
3. Swap, inside one short transaction: write back all re-encrypted rows, then the new canary
   last, then commit. The canary is the atomic marker: old canary means old data.
4. Post-commit: the section stays unlocked under `next`, every key cache keyed by the
   previous passphrase is evicted, and the rotation is logged without secrets (section, row
   counts).

Failure semantics: a failure in step 2 leaves everything untouched and the old passphrase
working; a failure inside the swap rolls the transaction back; a crash after commit and
before the response leaves the data already rotated (re-unlock with `next`).

## Decisions (recorded so they are not re-litigated)
- **Synchronous with a short transaction ("prepare then swap").** 012 asked for
  "re-encrypt ... inside a transaction" and "started in the background with progress
  reporting", and defined no progress endpoint; both cannot hold at once, and a write
  transaction left open for the whole KDF/decrypt work could not be observed for progress.
  Resolution: all heavy work happens before the transaction; the transaction covers only the
  writes and the canary swap. Progress reporting is dropped for v1 - the endpoint answers
  when the swap is committed. A background job with a progress endpoint would be a new spec.
- **Canary written last, inside the same transaction** (kept from 012): it is the commit
  marker and what a later unlock verifies against.
- **The passphrase is never stored, only the canary.** Rotation replaces the canary; there is
  no passphrase history and no recovery path (012).
- **Salt is not rotated, only the passphrase.** Data salts stay (shared per section for notes,
  per record for apis, per account and per history row for counts): keys change because the
  passphrase changes and nothing else about storage changes.
- **`notes.salt` (row copy of the section key) is refreshed by the rotation** so the row stops
  pointing at the previous key. It keeps its current semantics: part of the shared-salt design
  of notes (one key for the whole section), out of the decrypt path.
- **`vault` is a valid target with no data**: rotation is canary-only, not an error.
- **The section stays unlocked under the new passphrase** after a successful rotation: with
  caches keyed by passphrase there is no stale-key window, and the user is not kicked out of
  the section they just rotated.
- **Sections rotate independently**: `notes` and `notes_private` have their own passphrases
  and their own rotation calls (010).
- **Extracting the shared key primitives belongs to this spec, not to a follow-up**: the
  rotation needs one key model per section, and leaving four parallel derivations would give
  the rotation four code paths to keep in sync (rule: no two parallel systems per domain).

## Data model (no migration)
Write-back per section:

| Section | Rows to re-encrypt | Key to derive | What is written back |
|---|---|---|---|
| `notes` | `notes` where `is_private = false` | 1 derivation with the settings salt | `ciphertext`/`iv`/`auth_tag` per row + `salt` (section key copy) |
| `notes_private` | `notes` where `is_private = true` | 1 derivation with the settings salt | same |
| `apis` | `api_keys` | 1 derivation per row (row salt) | `ciphertext`/`iv`/`auth_tag` per row, salt untouched |
| `counts` | `counts_accounts`, `counts_password_history` | 1 heavy derivation per account + 1 per history row | the 5 secret column sets per account; `ciphertext`/`iv`/`auth_tag` per history row; salts untouched |
| `vault` | none | none | canary only |

`${section}.canary` in settings is replaced for every section (new random salt, new canary).

## Endpoint
```
POST /auth/change-passphrase/:section
body: { current: string, next: string }
200: { ok: true, section, records: number }   // records re-encrypted (0 for vault)
400: invalid section, invalid/too short next, next === current
401: section locked, or current does not match the canary
409: section has no canary configured (POST /auth/set-passphrase/:section is the one to use)
```
The route lives in the auth gateway because the URL comes from 012, and delegates to the
rotation service; the controller validates nothing beyond the body shape.

## Files (planned)
- `apps/backend/src/services/crypto/section-keys.ts` (new): salt model per section,
  derivation, cache keyed by (section, passphrase).
- `apps/backend/src/bll/rotation/rotation.service.ts` (new): orchestrator (prepare then swap)
  and registry of per-section rotators.
- `apps/backend/src/bll/rotation/section-rotator.ts` (new): the rotator contract.
- `notes.service.ts`, `api-keys.service.ts`, `counts.service.ts`: implement the rotator and
  delegate derivation to the shared module; the `NotesService` cache becomes passphrase-keyed.
- DAL: bulk re-encryption write per repository (notes, apis, counts), all joining the same
  transaction through a tx-scoped helper in `dal/drizzle.provider.ts`.
- `gateway/auth/auth.controller.ts`: new route, delegating to the rotation service.

## Acceptance criteria
- [ ] Rotating each of the five sections succeeds and every record is still readable with the
      new passphrase (list, reveal and history).
- [ ] After the swap the old passphrase no longer unlocks the section (401) and the new one
      does.
- [ ] A failure during "prepare" leaves the old passphrase working and no row modified
      (verified by injecting a failure).
- [ ] A failure during the swap rolls back: canary and data stay consistent with the old
      passphrase.
- [ ] Wrong `current` returns 401 with no change; unconfigured section returns 409;
      `next === current` returns 400.
- [ ] `vault` rotates its canary and returns `records: 0`.
- [ ] After a rotation no service encrypts with the previous key (passphrase-keyed cache) and
      the `notes.salt` copies hold the new key.
- [ ] Row counts per table are identical before and after the rotation.
- [ ] No passphrase, key or secret reaches the logs (011 redaction holds).
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)
- `npx tsc -p apps/backend/tsconfig.json --noEmit` plus `npm run build` (CI parity).
- Smoke against dev: rotate `notes` (has rows) and `counts`; then unlock with the old
  passphrase (expect 401) and with the new one (expect 200) and read every record.
- Failure injection before the swap (temporary throw in dev, removed afterwards): the old
  passphrase still works and no row changed.
- Row counts per table before/after, plus a check that a previous ciphertext no longer
  decrypts (proves the re-encryption actually happened).