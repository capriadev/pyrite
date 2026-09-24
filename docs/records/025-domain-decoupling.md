# 025 Domain decoupling - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this
file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **The three couplings are gone**, checked by listing every import that climbs out of its own
  folder:
  - `finances.service` no longer imports `DisputesIntakeService` (nothing from `disputes/`), and the
    intake still answers on creation (`intake` with kind `new_task` on the smoke).
  - `dispute-matcher` and `dispute-pass.service` import the date helpers from `types/dates`; the
    matcher has no import from `tasks/` at all, and its 22 assertions stayed green unchanged.
  - `calendar.service` takes `TasksService` and asks it for `calendarInput`; the only remaining
    reference to the tasks repository is the two row types, not the class.
- **10 HTTP checks** (`apps/backend/test/smoke-025-decoupling.mjs`): the balance is read, eight
  movements are created **simultaneously** against the same key and all eight deltas apply (800 of
  800), deleting one reverts exactly its delta, deleting it twice does not revert twice, the intake
  still answers on the saved movement, and the calendar still answers.
- **The test detects the old defect**: with the atomic increment swapped back to the previous
  read-modify-write, the same smoke reports `200` instead of `800` for eight movements of 100 (six
  deltas lost) and fails. The fix was restored afterwards and the smoke went back to green.
- No regressions: the five assertion files (34 + 22 + 31 + 19 + 44) and the nine previous smokes
  stayed green.

## Decisions taken while building

- **The composition moved to the gateway** instead of inventing an event bus: finances saves, the
  controller asks the intake afterwards. The tolerance to a failing intake lives in the intake
  itself (`intakeForSaved`), which is where the knowledge that this is an extra belongs, so the
  saved answer never depends on the engine.
- **Types are not implementation**: calendar and the recurrence engine may import row types from
  the tasks repository. What was removed is the dependency on the class that does the queries.
- **The balance increment is the only SQL-side arithmetic** in finances: the manual
  `POST /finances/balances` stays an absolute write on purpose, because it is the user overriding
  the number, not accumulating a delta.

## Audit result (recorded, not changed)

The audit that opened this spec found the DAL fully clean (eleven repositories depending only on
`drizzle.provider` and the schema) and the pure modules liftable as-is: `recurrence-engine`,
`dispute-matcher`, `dispute-scorer`, `log-retention`, `log-reader`, `counts-fields`, `counts-view`,
`types/guards`, `types/dates`, `services/crypto/*` and `integrations/*`. The security blocks depend
on the shared platform (crypto, auth, groups, rotation), which is not a domain coupling.

## Not verified

Nothing beyond the API: the UI that would show the balances is #24, and multi-currency (#33) does
not exist yet.
