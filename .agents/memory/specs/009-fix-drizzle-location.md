# Fix drizzle location - move to backend

## Objective
Move the drizzle schema, migrations and config inside `apps/backend` so the backend build is a standard single-app layout. The schema was living at the repo root (aesthetic choice), which forced `rootDir: ../..`, a `dist/` with the `apps/backend/` prefix, and 5-level relative imports to the schema. Moving it in simplifies the build permanently and is a prerequisite for the layer reorganization (spec 008).

## Scope
- In scope:
  - `drizzle/` (schema.ts + migrations + meta) -> `apps/backend/drizzle/`.
  - `drizzle.config.ts` -> `apps/backend/drizzle.config.ts` (paths relative to backend already correct).
  - Root `orm:*` scripts -> point to `apps/backend/drizzle.config.ts`.
  - Backend tsconfig: `rootDir: .` (output clean, no prefix).
  - Backend `start:dev`/`start:prod` -> `dist/src/main.js`.
  - Fix schema imports in dal files (`../../../../drizzle/schema` -> `../../drizzle/schema`).
  - Update architecture.md (drizzle is a backend asset), READMEs, memory note.
- Out of scope:
  - Layer reorganization by domain (spec 008 - comes after, on this clean base).
  - Any behavior change.

## Approach
- `git mv` the folder/config, update scripts and imports, set rootDir to `.`, verify with tsc/build/orm-generate and a health smoke.

## Acceptance criteria
- [ ] Schema + migrations live under apps/backend/drizzle; config under apps/backend.
- [ ] `npm run orm:generate` works from repo root with the new config path.
- [ ] `npm run tsc` passes (strict) in backend.
- [ ] Build produces dist/src/main.js (no apps/backend/ prefix); prod start uses it.
- [ ] `/health` returns 200.
- [ ] architecture.md/READMEs reflect drizzle location.