# Auth core + crypto en capas

## Objective
Implement the security foundation of Pyrite: a single crypto module with parametrizable profiles (light/medium/heavy) that serves both hash-only verification (login) and reversible encryption (KDF + AES-256-GCM) for sensitive sections. State of unlock per section lives in process memory with TTL of inactivity; no JWT, no sessions, no recovery.

## Scope
- In scope:
  - Single crypto module (`apps/backend/src/crypto/`) with three operations: `hash` (Argon2id verification), `kdf` (Argon2id raw key derivation), `encrypt/decrypt` (AES-256-GCM).
  - Three strength profiles (light/medium/heavy) from `.env`: memoryCost, timeCost, parallelism, shared_salt flag. One module, no parallel implementations.
  - Pepper per section (`.env`), applied as input to both hash and KDF.
  - Salt per record (not shared). Each ciphertext carries its own salt.
  - Canary verification: unlock attempt tries to decrypt a known canary; GCM authTag validates the passphrase (no double KDF).
  - AAD (additional authenticated data) bound to the record id, preventing ciphertext swap.
  - Unlock state per section in process memory, with configurable TTL of inactivity. Login barrier does NOT auto-lock.
  - Debugging: `GET /auth/status` returns which sections are unlocked.
  - Endpoints: `POST /auth/unlock/:section`, `POST /auth/lock/:section`, `POST /auth/set-passphrase/:section`, `POST /auth/change-passphrase/:section` (re-encrypts all data in that section).
  - Login barrier: `POST /auth/login`, `GET /auth/status` reports locked/unlocked. Password hash stored in settings.
  - `.env` blocks: `CRYPTO_PROFILE_*` (three profiles), `CRYPTO_*_PEPPER` (per section), `PASSWORD_PEPPER` (login).
- Out of scope:
  - Cloud segura (vault) file encryption (chunked AES-GCM scheme deferred).
  - API key validators (feature #6, pending).
  - Any UI page - this is backend-only (frontend consumes the `/auth/*` endpoints later).
  - Password change with re-encryption of existing data (defined in approach but tested in a later iteration).

## Approach
- `crypto/` folder: `crypto.service.ts` (hash/kdf/encrypt/decrypt), `crypto.module.ts`, per-profile config from `.env` typed as `CryptoProfile`.
- `AuthService` with lock state map <section, unlocked_at|undefined>. On unlock: KDF → verify canary → store key in memory. On TTL expire: discard key. On lock: immediate discard.
- Data stored in `settings` table (spec #3) with namespaced keys: `counts.salt`, `counts.params`, `counts.canary`, `counts.canary_iv`, `counts.canary_tag`. Encrypted records use the same table or dedicated tables decided later.
- AAD: each record stores its `id` as AAD, so `GCM.setAAD(Buffer.from(recordId))` before encrypt/decrypt.
- Login: `settings` key `auth.password_hash`, `auth.salt`, `auth.params`. Verify with `hash()`.

## Acceptance criteria
- [ ] `crypto/` module compiles with strict TS, no external crypto libs (Node built-in crypto + argon2).
- [ ] `POST /auth/login` with correct password works; incorrect returns 401.
- [ ] `POST /auth/unlock/counts` with correct passphrase unlocks; `GET /auth/status` shows it.
- [ ] `POST /auth/lock/counts` locks immediately.
- [ ] Canary verification works: bad passphrase on unlock returns 401 without revealing data.
- [ ] `.env` blocks for profiles and peppers are documented in `.env.example`.
- [ ] `npm run tsc` passes (strict).