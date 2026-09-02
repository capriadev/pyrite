# Frontend skeleton (Next.js)

## Objective
Stand up `apps/frontend` as a runnable Next.js (App Router) application with TS strict and Tailwind v4, following the "Atomic Lazy Design" 3-layer component architecture and the token-based theming decision from architecture.md. It must talk to the backend exclusively through a single typed gateway client and prove the full circuit with a status view consuming the backend /health endpoint.

## Scope
- In scope:
  - Next.js App Router app in `apps/frontend` (src dir), TS strict, Tailwind v4.
  - Structure: `app/` (routes), `components/` (atoms/molecules/organisms), `hooks/`, `lib/api/` (single typed gateway client), `lib/events/` placeholder, `theme/tokens.css` (token source) + `theme/presets/` placeholder.
  - `public/assets/` subfolders for icons/, logos/, sounds/, fonts/ (favicon stays loose in `app/` per project convention).
  - Status view consuming backend `GET /health` via the gateway client (app/postgres/redis indicators).
  - `engines` aligned with Node 24.20.0; workspace scripts (`dev`, `build`, `tsc`).
- Out of scope:
  - Real features (finances, tasks, etc.), auth, theming presets content, i18n implementation, WebSocket client (HTTP only for now), sound/font pluggable loading mechanics.

## Approach
- Scaffold Next manually-configured (no demo pages), App Router, `src/` layout.
- `lib/api/client.ts`: typed fetch wrapper with base URL from a single config module (`NEXT_PUBLIC_GATEWAY_URL`, default http://localhost:3001). Gateway URL is client-side config only (runtime system config lives in DB on the backend).
- Status view: server-friendly fetch on the route with client indicators; render green/red per service. No business logic in components.
- Tailwind v4 with CSS-first config; `theme/tokens.css` imported globally as the token source.

## Acceptance criteria
- [ ] `npm run dev` runs frontend (3000) and backend (3001) via root concurrently.
- [ ] Status view reflects real backend health (200 green / failure red).
- [ ] `npm run tsc` passes with zero errors in both workspaces (strict).
- [ ] Folder structure matches architecture.md (components/hooks/lib split, assets subfolders present).
- [ ] Root scripts (`dev:frontend`, `build:frontend`, `tsc`) work from repo root.