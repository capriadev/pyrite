# Rates sync (sub-spec B)

## Objective
Maintain a daily time-series of USD ARS rates (all types: blue, official, bolsa/MEP, CCL, mayorista, tarjeta, solidario, cripto) from ArgentinaDatos, with intradia refresh from dolarapi for conversion timeliness. Boot fills gaps; hourly sync refines; daily cross-check detects desfase.

## Scope
- In scope:
  - `integrations/argentinadatos.client.ts`: fetches `GET /v1/cotizaciones/dolares` (full series, all types, ~30k rows, 2011-01-03 to yesterday).
  - `integrations/dolarapi.client.ts`: fetches `GET /v1/dolares` (current rates, intradia).
  - Table `rates_daily`: type (text), buy, sell, date (unique type+date). `type` as text so new types enter without migration.
  - `RatesService`: reconcile (upsert missing dates + update current day, idempotent), intradiaLatest, getSeries, compareDaily (dolarapi vs argentinatedatos for divergence detection).
  - Scheduler: hourly for dolarapi intradia; each run also triggers a full ArgentinaDatos reconcile if >6h since last; daily cross-check.
  - `rates` gateway: GET /rates/latest?type=, GET /rates/series?type=&from=&to=, POST /rates/sync (manual trigger).
  - Helper: getRate(type, date) for movement conversion - uses dolarapi intradia blue venta, falls back to latest daily.
- Out of scope:
  - Dashboard charts (sub-spec C).
  - Auto-insert conversion rate into existing movements.

## Approach
- Reconcile: fetch full series from ArgentinaDatos, walk rows, insert on conflict do nothing for dates that already exist. ~30k rows, trivial for Postgres.
- Dolarapi: cache latest in memory (refreshed hourly); served for /latest and conversion helper.
- Daily check: log warning if last ArgentinaDatos date is >2 days behind.

## Acceptance criteria
- [ ] Sync from ArgentinaDatos fills all types from 2011-01-03 onward (covers 2025+).
- [ ] Re-running the sync does not duplicate rows (idempotent).
- [ ] Boot sync fills gaps after downtime.
- [ ] `GET /rates/latest?type=blue` returns most recent blue venta (from dolarapi if online, else daily).
- [ ] `npm run tsc` passes (strict).