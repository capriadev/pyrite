# 015 Calendar core

## Objective

Give the Calendario section its data layer: tasks as the single owner of everything with a
date (punctual, recurring, payments, birthdays, appointments, outings), the shared
recurrence engine with its business-rule evaluation (price tiers), materialized
expectations with stable ids, and the read API the calendar view consumes. Calendar itself
has no logic: it is receptor and display of what tasks computes. Payment tasks carry an
optional financial payload whose amount is an estimate, never an authority: finance
(spec 005) stays the single source of truth of real amounts.

## Current state (pre-check before this spec)

- Nothing of calendar or tasks exists: no tables, no modules, no endpoints. `features.md`
  has #18 (Calendar) and #19 (Tasks) pending; `docs/p1b.md` documents the intended design:
  a custom recurrence engine instead of RRULE (evaluated and discarded), price tiers with
  their own billing cycle, expected amounts as estimates, and a future reconciliation by
  expected date plus entity/category, never by amount.
- Foundations reused later, not by this spec: finance movements (005) as the real source
  for the reconciliation of 018, rates (006) for conversions, logging with redaction (011).
- This domain holds no secrets: unlike notes, apis and counts, calendar data is dates,
  titles and estimates, so there is no crypto section and no passphrase gate. Recorded so
  it is not re-litigated.
- The v1 subscription modal (name, icon, mode recurrent/installments, price with currency,
  frequency, start, trial days, ends after N) maps one to one onto the payload below; it is
  not migrated, it is re-expressed as a task of type `pago`.

## Scope

- In scope: task model (types and shell), recurrence rule, price tiers, optional payment
  payload (mode, optional price with a fixed flag, currency, trial, installments, end
  condition), expectation materialization with stable ids and states, calendar read API
  (day and month), tasks CRUD.
- Out of scope: the organization layer (folders, groups such as `cumples`, kanban,
  task-to-expectation links), which is #19; projections (017); reconciliation (018); every
  UI; notifications; the AI agent writing entries.

## Approach

Migration 0008, tables:

- `tasks`: `id`, `title`, `icon`, `type` (`puntual` | `recurrente` | `pago`), `status`
  (`active` | `paused` | `deleted`), `notes`, `starts_on`, `created_at`, `updated_at`.
- `task_recurrence` (one row per recurring task): `frequency_unit` (`day` | `week` |
  `month` | `year`), `interval` (default 1, so "every 3 years" is 3 + `year`),
  `ends_mode` (`never` | `on_date` | `after_count`), `ends_on`, `occurrences_count`.
- `task_price_tiers` (ordered): `task_id`, `position`, `amount` numeric(14,2) nullable,
  `currency` (`ARS` | `USD`), `applies_from` (date or occurrence index): the promo that
  becomes a regular price.
- `task_payments` (only for `type = pago`): `mode` (`recurrente` | `cuotas` | `fija`),
  `price_fixed` boolean, `price_amount` nullable, `price_currency`, `trial_days`,
  `installments_count`.
- `task_expectations` (materialized occurrences): `id` (stable, referenced later by the
  reconciliation), `task_id`, `expected_on`, `estimated_amount` nullable, `currency`,
  `tier_position`, `status` (`pending` | `settled` | `exception` | `cancelled`), unique on
  (`task_id`, `expected_on`).

Services:

- `RecurrenceEngine`: pure computation (no persistence, no DI). Given the rule, the tiers,
  the payment payload and a range, it returns the occurrences and, per occurrence, which
  tier applies. This is the business-rule evaluation: trial shifts the first charge, tiers
  switch by position or date, installments cap the series at N, `ends_mode` closes it.
- `TasksService`: CRUD with boundary validation in one place, soft delete, and an edit that
  leaves already materialized past expectations intact and regenerates only the future ones.
- `ExpectationsService`: materializes a rolling horizon (default 12 months) on write and on
  demand, idempotent on (`task_id`, `expected_on`).
- `CalendarService`: read-only aggregation for a range: per day, the tasks and expectations
  that fall on it, with estimated amount and state.
- Gateway: `/tasks`, `/calendar`, `/tasks/:id/expectations`.

Decisions recorded:

- Expectations are materialized instead of computed per request, because the reconciliation
  of 018 needs a stable id to point at, and because the calendar view must not re-evaluate
  rules on every read.
- No conversion happens here: an estimate in USD stays in USD with its currency. Converting
  for display belongs to the projection engine (017).

## Endpoints

```
GET    /calendar?from=&to=          day-by-day aggregation for the range
GET    /tasks                       list (filters: type, status, range)
POST   /tasks                       create (puntual | recurrente | pago)
GET    /tasks/:id
PUT    /tasks/:id                   edit (past expectations untouched)
DELETE /tasks/:id                   soft delete
GET    /tasks/:id/expectations      materialized occurrences
```

## Acceptance criteria

- [ ] A punctual task with a date appears in `/calendar` on its day.
- [ ] An annual task ("Cumple de X") produces one occurrence per year inside the horizon.
- [ ] A monthly subscription with 14 days of trial starts charging on start + 14.
- [ ] A price marked fixed in USD produces the same amount every period, currency preserved.
- [ ] `ends_mode = after_count` stops generating after N occurrences.
- [ ] Installments mode with N = 12 produces exactly 12 expectations of the fixed amount.
- [ ] Tiers: the promo amount applies for its cycles and the next tier takes over
      afterwards (the 1000 then 2500 case).
- [ ] A payment with no price (variable service) produces date-only expectations with
      `estimated_amount` null and no invented value.
- [ ] Re-running materialization produces no duplicates and never rewrites past
      expectations.
- [ ] Soft delete stops future materialization and keeps the record.
- [ ] No secret is stored and no crypto section is involved.
- [ ] `npm run tsc` and `npm run build` pass (strict).

## Verification (planned)

- `npx tsc --noEmit` and `npm run build`.
- Seed: a birthday, a punctual appointment, a USD fixed subscription with trial, an ARS
  subscription with two tiers, a 12-installment purchase and a variable service with no
  price; then read `/calendar` for the next 12 months and check each case against its rule.
- Idempotency: run materialization twice and compare row counts; edit a task and confirm
  only future expectations changed.
- Boundary cases: tier switch, last installment, `after_count` limit, paused task.


