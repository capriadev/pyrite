# Architecture - Pyrite

Single source of truth for how Pyrite is built. Update on every trade-off. Mark changes `[SUPERSEDED]` instead of deleting.

## Identity
- Name: **Pyrite**. Personal, single-user, private, local-first. Public repo (clone-and-run).
- GUI name on machine: **Pyrite**. No "OS" suffix.

---

## Stack (decided base)

| Layer | Tech | Notes |
|---|---|---|
| Interfaz (`apps/frontend`) | Next.js + TypeScript + Tailwind CSS | Decoupled: components, hooks, events. What the user uses. |
| Backend (`apps/backend`) | Nest.js + TypeScript | Modular by responsibility: `dal/`, `bll/`, `gateway/`, `integrations/`, `services/`. Runs alone/isolated. |
| DB | PostgreSQL + Redis | Provided by Docker. Postgres = source of truth; Redis = cache/perf. |
| Container | Docker container named `pyrite` | `docker/` folder holds compose + instances. |
| ORM | Drizzle (typed) | Candidates considered: Prisma (more known), Kysely (newer). |
| Config | In-DB, not `.env` | Settings/vars stored in DB, loaded at boot. Allows rotating providers/keys/models at runtime. |
| Windows startup | `node-windows` service (or NSSM) | Backend runs alone at Windows boot, even before login. Node can do this; Rust/Go only needed for extreme volume/CPU, not startup. |

### Sidecars (own code, OS-level control)
- Rust or Python **required** for Spotify volume control (Windows) - what `spoti-pobre` does today. Smallest possible sidecar.
- Lives under `sidecars/`. Not vendorized software - code you write and maintain.

### Satellite services (vendorized, external processes)
- Third-party software (Cobalt, spotdl, open-notebook) installed inside the repo but run as independent processes.
- Backend never imports their code - only consumed via `apps/backend/src/integrations/` over HTTP/CLI.
- Lives under `satellite-services/`.

---

## Repository layout (planned)

```
repo root/
├── AGENTS.md                     agent manual-router
├── README.md                     project entry point
├── package.json                  workspace scripts/deps
├── apps/
│   ├── backend/                  Nest.js backend
│   │   └── src/
│   │       ├── bll/
│   │       ├── config/
│   │       ├── dal/
│   │       ├── gateway/
│   │       ├── integrations/
│   │       └── services/
│   ├── bot-discord/              Discord bot app
│   └── frontend/                 Next.js UI
├── docker/                       compose for container `pyrite` + instances
├── docs/                         human-readable philosophy/manifesto
├── drizzle/                      schema/migration assets
├── satellite-services/           external service adapters and helpers
├── sidecars/                     auxiliary sidecar processes
├── temp/                         local temp files, generated assets, logs
├── .agents/
│   ├── memory/                   agent memory (this system)
│   └── skills/                   project skills
├── skills-lock.json
├── LICENSE.md
└── .git/
```

> This layout intentionally does not include any nested `.agents/.agents/*` reference. The old `memory-other-system` path was a stale artifact and is not part of the active repository structure.

---

## Security (multi-layer, feature core from day 1)
- System login: passphrase → server hashes (Argon2 chain), encrypt; nothing accessible even from DB.
- Storage sections: `apis`, `claves`, `cloud/bóveda` (mode `password` + mode `secure`).
- Optional activable layer: physical USB key replacing internal security for critical sections (design pending; unresolved: loss/damage).
- Auth from day 1; no `.env` (config in DB). Details to be written as sections develop.

## Integrations (progressive versions, not MVP)
- Dólar (dolarapi + full history sync). spoti-pobre. open-nb (rewrite, DB→Postgres, double mode). Downloads (Cobalt + spotdl + FFmpeg). Search (You.com; free fallback DuckDuckGo). Discord bot (private, same Docker, userID-locked). See `features.md`.