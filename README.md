# Pyrite

Personal, single-user, private and local-first system. Your sensitive data never leaves your machine and everything is stored encrypted. It is a personal control panel with its own backend running on your machine; the UI is deliberately simple, the strength is inside (security, layered architecture, local data).

> Spanish version: [README-es.md](README-es.md)

## Requirements
- nvm (Node Version Manager)
- Node.js 24.20.0 - the repo ships a `.nvmrc`: `nvm install` then `nvm use`
- Docker (Docker Desktop)

## Local setup
```bash
# 1. Install dependencies
npm ci

# 2. Backend environment (required to boot)
copy apps\backend\.env.example apps\backend\.env
# adjust credentials/ports if your machine needs different ones

# 3. Infrastructure (Postgres + Redis)
npm run docker:up

# 4. Frontend + backend together
npm run dev
# or separately: npm run dev:backend / npm run dev:frontend
```

> Two different kinds of configuration: what belongs to the user (providers, keys, models, preferences) lives in the DB and rotates at runtime; backend boot settings (crypto peppers, Argon2id params, port, DB credentials) come from `apps/backend/.env`.

## Database (Drizzle)
Schema lives in `apps/backend/drizzle/schema.ts` and is applied **always** with the safe flow: `npm run tsc` -> `npm run orm` (generates `.sql`, does not touch the DB) -> **review the generated `.sql`** -> `npm run orm:migrate`. Never `orm:push` against real data. Details in [`.agents/skills/pyrite-orm/SKILL.md`](.agents/skills/pyrite-orm/SKILL.md).

## Backups
```bash
npm run back
```
Copy `backup.config.example.ps1` to `backup.config.ps1` (gitignored) and adjust your paths. Supports local destinations, external drives and cloud/remote targets via rclone; includes a database dump.

## Docs
- [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) - principles, intent and method.
- [`.agents/memory/architecture.md`](.agents/memory/architecture.md) - stack, layers and trade-offs.
- [`AGENTS.md`](AGENTS.md) - how work is organized in this repo (specs, branches, commits).

## License
[MIT](LICENSE.md)
