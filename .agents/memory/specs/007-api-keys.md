# APIs section (storage de API keys)

## Objective
Build the APIs section backend: store API keys encrypted at rest (KDF + AES-256-GCM, medium profile), with per-provider validators that mark each key as valid/expired/invalid. Endpoints are gated by the `apis` section unlock (passphrase + canary from spec #4).

## Scope
- In scope:
  - Table `api_keys`: id, provider (text), label, detail (nullable), ciphertext, iv, authTag, salt, group_id (nullable FK), status (active/deleted), validator_status, last_checked, timestamps.
  - Table `api_groups`: id, name, status (soft delete), created_at.
  - Encryption on write using AuthService.getSectionPassphrase('apis') + CryptoService with per-record salt (medium profile), AAD bound to row id.
  - CRUD gated by `apis` unlock: create/list/show/delete (soft), get key value (decrypted, only while unlocked), move key to group, update label/detail.
  - Groups: list/create/delete (soft) - one key belongs to zero or one group.
  - Providers: flat single-file clients in `integrations/providers/` (openai/anthropic/github), registry at `integrations/providers/index.ts`.
  - Gateway: GET /apis (masked), GET /apis/:id/value, POST /apis, POST /apis/:id/validate, DELETE /apis/:id, PUT /apis/:id/label, PUT /apis/:id/detail, PUT /apis/:id/group, GET/POST /apis/groups, DELETE /apis/groups/:id.
- Out of scope:
  - UI (frontend comes later).
  - Auto-validate all on every entry into the section (per-row explicit validation for now).
  - Web/Notes sections (parallel storage in p1b).
  - Nested groups (possible future extension, noted).

## Approach
- Encryption: reuse 'apis' section profile (medium) from crypto-config. Each key stored with its own salt (per-record salt rule). Encrypt on create; AAD is bound to the row id (UUID); decrypt only in GET /apis/:id/value and during validation.
- Providers: single flat file per provider in `integrations/providers/`, holding ALL its API query methods (validate, listModels, chat/embeddings when needed). `index.ts` is the ONLY entry point consumers import from (registry name -> client). Splitting deferred until a file grows past ~150-200 lines (agent/notebook usage); when it does, split into `providers/{name}/` micro-modules - consumers unaffected (they import from index.ts).
- Groups: modelo carpeta - a key belongs to zero or one group. Groups are flat for now; nested groups (groups of groups) are a possible future extension, noted but not designed. Delete group (soft) sets keys' group_id to NULL via FK ON DELETE SET NULL.
- Validators: unknown provider has no automatic validation -> status remains 'unchecked' (honest, not assumed valid).

## Design notes (documented so we don't lose the plan)
- Providers start as flat single files (option A). When one grows past ~150-200 lines via agent/notebook usage, split into `providers/{name}/` micro-modules (`agent.client.ts`, `models.client.ts`). The refactor is invisible to consumers because they always import from `providers/index.ts`. A planned, documented future step - not to decide ad-hoc when it happens.
- Groups flat now, nested as a possible future extension (groups of groups) - noted here so it's revisited deliberately if needed.

## Acceptance criteria
- [ ] Backend CRUD for api_keys, gated by apis section unlock.
- [ ] Keys stored encrypted at rest (ciphertext/iv/authTag/salt); raw key never stored.
- [ ] GET /apis lists masked info (no key); GET /apis/:id/value returns decrypted key only while section is unlocked.
- [ ] POST /apis/:id/validate calls the provider validator and stores valid/expired/invalid + last_checked.
- [ ] Soft delete via status=deleted.
- [ ] `npm run tsc` passes (strict).