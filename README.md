# Pyrite

> "Fool's gold": humble on the outside, solid on the inside.

Personal, **single-user**, private and **local-first** system. Your sensitive data never leaves your machine. Public repo: anyone can clone it and run it locally (not a SaaS).

> Spanish version: [README-es.md](README-es.md)

## What it is
A personal control panel integrating finances, tasks, calendar, a password manager, API key storage, a private vault and more - all in one system with its own backend, running on your machine. The UI is deliberately simple; the strength is inside (security, layered architecture, local data).

## Project status
Under active construction. The scaffolding is in place; features are built through progressive versions guided by specs (see [Roadmap](#roadmap)).

## Features (progressive)
- **Dashboard** - KPIs, daily tasks, cash flow.
- **Finances** - income/expenses, categories, multi-currency (ARS/USD/EUR), Excel export.
- **Tasks** - modular system with rich recurrences.
- **Calendar** - subscriptions and events.
- **Passwords** - encrypted manager with master key + 2FA.
- **API Keys** - encrypted storage with per-provider validators.
- **Webs** - links with smart groups and AI descriptions.
- **Vault** - private cloud with password mode and secure mode.

## Stack

| Layer | Tech |
|---|---|
| Frontend (`apps/frontend`) | Next.js + TypeScript + Tailwind CSS |
| Backend (`apps/backend`) | Nest.js + TypeScript |
| DB | PostgreSQL + Redis (Docker) |
| ORM | Drizzle (typed) |
| Security | Argon2id + AES-256-GCM |

## Architecture
- **Layered modular backend**: `dal/` (data access), `bll/` (business logic), `gateway/` (HTTP/WS entry), `services/`, `integrations/` (external services consumed over HTTP/CLI - their code is never imported).
- **Config in DB, not `.env`**: all system configuration (including the API keys used by AI-powered modes inside the system) lives in the database and is loaded at boot. Lets you rotate providers/keys/models at runtime.
- **Satellite services** (`satellite-services/`): third-party software (Cobalt, spotdl, open-notebook) run as independent processes.
- **Sidecars** (`sidecars/`): own auxiliary processes (Rust/Python) for OS-level control (e.g. Spotify volume on Windows).
- **Windows startup**: the backend runs as a service (`node-windows`), even before login.

```
apps/backend · apps/frontend · apps/bot-discord
docker/ · drizzle/ · satellite-services/ · sidecars/
docs/ · .agents/ (agent memory & skills)
```

## Security
Core feature from day 1:
- Passphrase login → Argon2 (chained) hashing → encryption.
- Layered sensitive sections: `apis`, `keys`, `vault` (password mode + secure mode).
- Optional physical layer (USB key) in the future.

## Requirements
- nvm (Node Version Manager)
- Node.js 24.20.0 (the repo ships a `.nvmrc`: `nvm install` + `nvm use` activates it)
- Docker (Docker Desktop)
- rclone (only if using cloud backups)

## Local setup
```bash
# 1. Infrastructure (Postgres + Redis)
docker compose -f docker/docker-compose.yml up -d
# or: npm run docker:up

# 2. Frontend + backend (single terminal)
npm run dev

# or separately:
npm run dev:backend   # Nest.js
npm run dev:frontend  # Next.js
```

> No `.env`: configuration is managed from the system itself (DB), loaded at boot.

## Database (Drizzle)
The schema is edited in `apps/backend/drizzle/schema.ts` and applied **always** with the safe flow: `npm run tsc` → `npm run orm` (generates `.sql`, does not touch the DB) → **review the `.sql`** → `npm run orm:migrate`. Never `orm:push` on real data. See `.agents/skills/pyrite-orm/SKILL.md`.

## Backups
```bash
npm run back
```
Copy `backup.config.example.ps1` to `backup.config.ps1` (gitignored) and adjust your paths. Supports local, external drive and cloud/remote targets via rclone; includes a DB dump.

## Roadmap
1. **Phase 0** - Repo base (scaffolding, docs, backups).
2. **Phase 1** - App skeletons (Nest + Next), config in DB, auth core.
3. **Phase 2** - Core features: Finances → Tasks → Dashboard → Passwords/API Keys.
4. **Phase 3** - Integrations: Webs, Calendar, Vault, Dollar rates, Discord bot, Downloads, search, Spotify sidecar, satellite services, Windows service.

## Methodology
Spec-driven development (SDD): every change starts from a spec in `.agents/memory/specs/` indexed in `features.md`. GitHub Flow branches, Conventional Commits, strict TypeScript. Details in [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) and `AGENTS.md`.

## License
[MIT](LICENSE.md)