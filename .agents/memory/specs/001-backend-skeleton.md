# Backend skeleton (Nest.js)

## Objective
Stand up `apps/backend` as a runnable Nest.js application with the layered structure defined in `architecture.md` (dal/, bll/, gateway/, services/, config/, integrations/), wired to the Postgres/Redis Docker services via Drizzle. This is the foundation every future feature builds on, so it must compile strict, boot clean, and expose a health check proving DB and Redis connectivity.

## Scope
- In scope:
  - Nest.js app in `apps/backend` with module-per-layer layout (`dal/`, `bll/`, `gateway/`, `services/`, `config/`, `integrations/`).
  - Drizzle ORM configured (Postgres connection via `drizzle.config.ts`, empty `schema.ts`).
  - Redis connection (ioredis) as an injectable provider.
  - Health check endpoint (`GET /health`) reporting app, Postgres and Redis status.
  - Strict TypeScript, `npm run tsc` passing at root for the workspace.
  - Integration with root scripts: `dev:backend`, `build:backend`, `tsc`.
- Out of scope:
  - Any business feature (config-in-DB, auth, finances).
  - Migrations/schema content beyond an empty schema file.
  - Windows service (node-windows), satellite services, integrations content.
  - Frontend or bot-discord apps.

## Approach
- `NestFactory` bootstrap in `src/main.ts` loading config from the `config/` module; DB credentials read from a typed config object with local-dev defaults matching `docker/docker-compose.yml` (pyrite/pyrite@localhost:5432).
- One Nest module per layer: `DalModule` exports Drizzle client + repositories (empty for now), `BllModule` holds domain logic, `GatewayModule` holds controllers (HealthController), `ServicesModule` for cross-cutting app services, `IntegrationsModule` empty placeholder for future HTTP/CLI adapters.
- Drizzle via `drizzle-orm/node-postgres` pool; Redis via `ioredis` injected through a provider factory so it can be mocked in tests.
- Health endpoint pings both services and returns 503 if either fails.

## Acceptance criteria
- [ ] `npm run dev:backend` boots Nest without errors against `npm run docker:up` services.
- [ ] `GET /health` returns 200 with postgres:true and redis:true (and 503 when either is down).
- [ ] `npm run tsc` passes with zero errors (strict).
- [ ] `apps/backend/src` contains the layer folders from architecture.md; no business logic inside gateway.
- [ ] Root scripts (`dev:backend`, `build:backend`, `tsc`) work from repo root.

## Status
pending