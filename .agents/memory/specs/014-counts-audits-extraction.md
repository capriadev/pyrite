# 014 Counts audits extraction

Status: active (branch refactor/counts-audits).

## Objective

`counts.service.ts` reached 578 lines when the 013 rotator landed in it. The audits
(strength and duplicates) are a self-contained, read-only concern with dependencies of
their own (the settings threshold and per-record decryption), so they move to a service
of their own and the view projection they share with the CRUD paths becomes a module
instead of a private method. Pure refactor: same endpoints, same response shapes, same
behavior. It runs before Calendar/Tasks start living next to this domain.

## Current state (pre-check before this spec)

- `apps/backend/src/bll/counts/counts.service.ts`: 578 lines, sections ACCESS / READ /
  CREATE / UPDATE / REVEAL / HISTORY / AUDITS / ITEM OPS / GROUPS / HELPERS plus the 013
  rotator (`countUnits`, `stageSection`, `applySection`).
- Audit code inside it: `weakAudit()` and `duplicatesAudit()` (AUDITS section), the
  `weakThreshold()` helper and the `counts.weak_threshold` constants.
- `toViews()` / `toView()` are private and used by both the CRUD paths and the audits:
  keeping them private in one of the two services would force a duplicated mapper or a
  service-to-service dependency.
- `SettingsService` is injected into `CountsService` only for the audit threshold; the
  rest of the class never reads settings.
- Importers today: `gateway/counts/counts.controller.ts` (types `CountsAccountView` and
  `CountsDuplicateGroup` plus the service), `bll.module.ts` (provider/export) and
  `rotation.service.ts` (consumes `counts.rotators`, untouched by this spec).
- Endpoints affected, both must keep answering exactly as before:
  `GET /counts/audit/weak`, `GET /counts/audit/duplicates` (403 while the section is
  locked, 200 with the same body shape).

## Approach

- `apps/backend/src/bll/counts/counts-view.ts` (new): the metadata projection as a
  module, not a private method - `CountsAccountView`, `toView(row, groups)` and
  `toViews(repo, rows)` (tags are read through the repository passed in, so the module
  stays a pure mapping with no DI). Single source of truth for both services.
- `apps/backend/src/bll/counts/counts-audits.service.ts` (new): `CountsAuditsService`
  owns `weakAudit()`, `duplicatesAudit()`, `CountsDuplicateGroup`, the
  `counts.weak_threshold` key, the default threshold, the `weakThreshold()` helper and
  its own `requireUnlocked()` (the 3-line private guard already repeated in
  `api-keys.service.ts` and `counts.service.ts`; not extracted, since a shared module
  for it would be more surface than the duplication it removes). Dependencies:
  `CountsRepository`, `CryptoService`, `AuthService`, `SettingsService`,
  `SectionKeysService` (per-record derivation goes through `recordKey`, same as the CRUD
  path, so nothing about derivation is reimplemented).
- `apps/backend/src/bll/counts/counts.service.ts`: drops the AUDITS section, the
  threshold helper, its constants and the `SettingsService` dependency; imports the view
  projection from `counts-view.ts`. CRUD, reveal, history, groups and the 013 rotator
  stay untouched.
- `apps/backend/src/gateway/counts/counts.controller.ts`: injects
  `CountsAuditsService` alongside `CountsService`; the two audit routes delegate to it
  and the types come from their new homes.
- `apps/backend/src/bll/bll.module.ts`: `CountsAuditsService` registered and exported.

## Acceptance criteria

- [ ] `GET /counts/audit/weak` and `GET /counts/audit/duplicates` keep their exact
      contracts: same body shape, 403 while the section is locked.
- [ ] `counts.service.ts` no longer holds audit logic, the threshold helper or the
      `counts.weak_threshold` key, and no longer injects `SettingsService`.
- [ ] One single view mapper serves both services (`counts-view.ts`); no copy of
      `toView`/`toViews` anywhere.
- [ ] Duplicate audit keeps its semantics: decrypt per record, sorted by group size
      descending, only the password length leaves the service, nothing derived is
      persisted, undecryptable rows are logged and skipped.
- [ ] Weak audit keeps reading the persisted score (no brute force) and the settings
      threshold with its code fallback.
- [ ] The 013 rotator is untouched and `rotation.service.ts` still consumes
      `counts.rotators`.
- [ ] `npm run tsc` and `npm run build` pass (strict).

## Verification

- `npx tsc --noEmit` and `npm run build` from the repo root (CI parity).
- Code inspection: no audit or threshold string remains in `counts.service.ts`; the
  controller routes point at `CountsAuditsService`; `bll.module.ts` wires the provider.
- Live smoke (only if the test instance is already up, since starting services is not
  part of the task): with the `counts` section locked both audit routes answer 403;
  unlocked, weak returns the configured threshold and duplicates returns the same groups
  as before the refactor (same accounts, same order).
