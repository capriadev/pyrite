# Config en DB + env de infraestructura

## Objective
Separate the two config layers of Pyrite: backend infrastructure config read from `.env` (DB connection, ports) and user-facing system config stored in the DB (settings) loaded into memory at boot and mutated at runtime. This unblocks everything that depends on rotatable config (auth, integrations, agent keys).

## Scope
- In scope:
  - Backend `.env` + `.env.example` (DB_HOST/PORT/USER/PASSWORD/NAME, REDIS_HOST/PORT, BACKEND_PORT) read via dotenv with local defaults. Port block 30xxx (prod 30000-30019, test 301xx).
  - Docker compose: postgres host 30010, redis host 30011; init script creates `pyrite_test` on fresh volumes.
  - Drizzle multi-DB: config reads `DB_NAME` (default `pyrite`); `orm:migrate:test` targets `pyrite_test`.
  - `settings` table (key text PK, value jsonb, updated_at).
  - Backend layers: `dal/settings.repository.ts`, `bll/settings.service.ts` (boot load to memory + get/set), `gateway/settings.controller.ts` (GET /settings, GET /settings/:key, PUT /settings/:key).
  - First migration applied to test then production.
- Out of scope:
  - Auth on the settings API (spec #4; local-only for now, tech-debt noted).
  - `api_keys` table and provider validators (feature Webs/APIs).
  - Encryption at rest for settings (spec #4 crypto layers).

## Approach
- dotenv loaded in `configuration.ts`; `appConfig` reads process.env with dev defaults.
- Compose uses external volumes `docker_postgres-data`/`docker_redis-data` (existing data), port 30010/30011.
- `pyrite_test` created manually on the existing volume (init script only runs on fresh volumes).
- Settings service loads all rows into a Map at boot (OnApplicationBootstrap), get/set mutate memory and persist to DB.

## Acceptance criteria
- [ ] Backend boots reading `.env` (port 30001) and connects to postgres (30010) + redis (30011).
- [ ] `GET /health` returns 200 with postgres/redis true.
- [ ] `PUT /settings/:key` persists; `GET /settings` returns it; value survives a backend restart (loaded from DB).
- [ ] `pyrite_test` exists and `orm:migrate:test` targets it.
- [ ] `npm run tsc` passes (strict) in backend.
- [ ] Migration `.sql` reviewed before applying (no destructive statements).