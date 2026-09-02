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
| Bot Discord (`apps/bot-discord`) | TBD (likely discord.js + TypeScript) | Talks to backend only via `gateway/`, same rule as frontend. Not started yet - folder exists, empty for now. |
| Backend (`apps/backend`) | Nest.js + TypeScript | Modular by responsibility (see "Backend layers" below). Runs alone/isolated. |
| DB | PostgreSQL + Redis | Provided by Docker. Postgres = source of truth; Redis = cache/perf. |
| Container | Docker container named `pyrite` | `docker/` folder holds compose + instances. |
| ORM | Drizzle (typed) | Candidates considered: Prisma (more known), Kysely (newer). |
| Config | In-DB, not `.env` | Settings/vars stored in DB, loaded at boot. Allows rotating providers/keys/models at runtime. |
| Runtime | Node.js 24.20.0 via nvm | Pinned by `.nvmrc` at repo root. Version managed with nvm, not system-wide installs. |
| Windows startup | `node-windows` service (or NSSM) | Backend runs alone at Windows boot, even before login. Node can do this; Rust/Go only needed for extreme volume/CPU, not startup. |

### Backend layers (apps/backend/src) - strict responsibilities
- `dal/` - the ONLY layer that talks to the database. All queries/DB access concentrated here; no queries anywhere else (bll, services, gateway never touch DB directly).
- `bll/` - ALL business logic. Domain rules live here; consumed by gateway; uses dal for persistence. No HTTP, no DB access of its own.
- `gateway/` - realtime APIs (HTTP/WS). The ONLY communication medium between any client app (`apps/frontend`, `apps/bot-discord`) and the backend: no client talks to `bll/` or `dal/` directly. No business logic inside.
- `services/` - very specific internal services (shared, cross-cutting app-level helpers). Naming note: these are internal; do not confuse with "servicios satelitales" (external), which live in `satellite-services/`.
- `integrations/` - adapters for external world: future satellite-services adapters (repo-root `satellite-services/`) and `providers/` containing `<proveedor>.client.ts` files that validate/consume external APIs (e.g. AI providers). Support validators live here too. Core never imports satellite code directly - only through these adapters.
- `config/` - typed config loaded at boot (in-DB config lands here later).

### Sidecars (own code, OS-level control)
- Rust or Python **required** for Spotify volume control (Windows) - what `spoti-pobre` does today. Smallest possible sidecar.
- Lives under `sidecars/`. Not vendorized software - code you write and maintain.
- Spotify construction to be re-evaluated at build time: planned direction is a dual-mode service (integrated in backend / detached local agent with its own SQLite, WS to backend only while the frontend UI is open, for the split LAN setup: frontend + user on the main PC, backend on the home server).

### Frontend design system
- Component architecture: "Atomic Lazy Design". Minimal take on Atomic Design: three layers only - atoms, molecules, organisms (small / medium / complete). Separates without over-fragmenting. No further subdivision unless practice proves it necessary.
- Theming: change colors, fonts, sounds, component variants and layout element positions/order without touching code.
  - `theme/tokens.css`: single source of design tokens, consumed by all `ui/`; never hardcoded per component.
  - `theme/presets/`: full theme presets (built-in + custom), swappable at runtime.
  - Fonts and sounds load as pluggable extras, same mechanism as presets.
  - Dark/light + custom themes from day one via tokens.
  - All preferences persist in DB (config-in-DB). Settings UI exposes an appearance section (theme/font/custom) and a sounds section.
- Multi-language: Spanish and English only. Implementation library TBD (blocks nothing).
- Component sourcing policy: before installing any UI library or kit, evaluate copying/adapting the specific fragment needed instead of pulling a whole dependency (full libraries bring their own theming, which conflicts with the token system above). Even with pre-designed libraries, the approach is to adapt and limit what gets used. When a library IS justified, prefer copy-based approaches (shadcn/ui style: component code lives in the repo, not an opaque package) - same principle as "don't fork/copy-paste without customizing", applied to third-party UI.

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