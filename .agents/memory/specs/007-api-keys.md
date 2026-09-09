# APIs section (storage de API keys)

## Objective
Build the APIs section backend: store API keys encrypted at rest (KDF + AES-256-GCM, medium profile), with per-provider validators that mark each key as valid/expired/invalid. Endpoints are gated by the `apis` section unlock (passphrase + canary from spec #4).

## Scope
- In scope:
  - Table `api_keys`: id, provider (text), label, ciphertext, iv, authTag, salt, status (active/deleted), validator_status (unchecked|valid|expired|invalid), last_checked, timestamps.
  - Encryption on write using AuthService.getSectionPassphrase('apis') + CryptoService.createKey/encrypt/decrypt with per-record salt (medium profile).
  - CRUD gated by `apis` unlock: create/list/show/delete (soft), get key value (decrypted, only while unlocked).
  - Validators client per provider (openai, anthropic, github, custom) - ping endpoint with the key, mark status.
  - Gateway: GET /apis (list, masked - show label/provider/status, not the key), GET /apis/:id/value (decrypted), POST /apis (add), POST /apis/:id/validate, DELETE /apis/:id (soft), PUT /apis/:id/label.
- Out of scope:
  - UI (frontend comes later).
  - Auto-validate all on every entry into the section (decision noted in features.md #6: per-row explicit validation for now).
  - Web/Notes sections (parallel storage in p1b).

## Approach
- Encryption: reuse 'apis' section profile (medium) from crypto-config. Each key stored with its own salt (per-record salt rule). Encrypt on create; decrypt only in the GET /apis/:id/value and during validation.
- Validators: a small map provider → validate(key) via fetch; custom provider uses a user-provided endpoint. Store result in validator_status + last_checked.
- Auth guard: a simple guard/check that 'apis' section is unlocked before handling API key reads/creates; return 401 if locked.

## Acceptance criteria
- [ ] Backend CRUD for api_keys, gated by apis section unlock.
- [ ] Keys stored encrypted at rest (ciphertext/iv/authTag/salt); raw key never stored.
- [ ] GET /apis lists masked info (no key); GET /apis/:id/value returns decrypted key only while section is unlocked.
- [ ] POST /apis/:id/validate calls the provider validator and stores valid/expired/invalid + last_checked.
- [ ] Soft delete via status=deleted.
- [ ] `npm run tsc` passes (strict).