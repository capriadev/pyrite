# 025 Domain decoupling

## Objective

Fix the three cross-domain couplings found while auditing modularity, plus one correctness defect
that the same audit surfaced. The goal is that each domain (and, more importantly, each of the pure
modules) can be lifted into another project without dragging a neighbouring domain along, and that a
change inside one domain cannot break another one silently.

The audit looked at every `from '../...'` import in `dal/` and `bll/` (a cross-domain import is
exactly the one that climbs out of its own folder).

## Current state (pre-check before this spec)

What is already right, and stays untouched:

- **The DAL is clean**: the eleven repositories import only `drizzle.provider` and the schema,
  never another repository. Each one is a self-contained unit.
- **The pure modules are liftable as-is**: `recurrence-engine`, `dispute-matcher`, `dispute-scorer`,
  `log-retention`, `log-reader`, `counts-fields`, `counts-view`, `types/guards`, `services/crypto/*`
  and `integrations/*` depend on types and the standard library, not on Nest or a foreign domain.
- **The security blocks** (notes, apis, counts, rotation) depend on the shared platform (crypto,
  auth, groups, rotation): that is infrastructure, not a domain coupling.

The three couplings to fix:

| # | Import | Why it matters |
|---|---|---|
| 1 | `finances.service` -> `DisputesIntakeService` | A base domain (005) depends on a later one (021). Lifting finances drags the dispute intake along, and the intake decides the shape of the finances answer. |
| 2 | `dispute-matcher` -> `tasks/recurrence-engine` | A pure engine imports two date helpers (`addDays`, `isoDay`) from another domain's engine: a whole domain pulled in for arithmetic. |
| 3 | `calendar.service` -> `TasksRepository` | Calendar bypasses the tasks service and reads its repository directly, so a change in how tasks reads is invisible to calendar. |

And one defect found in the same pass:

- **The balance update is not atomic**: `createMovement` does `getBalance` -> add -> `setBalance`.
  Two concurrent writes read the same value and one overwrites the other, losing a delta for good.
  Same pattern in `softDeleteMovement`. This is correctness, not concurrency optimisation.

## Scope

- In scope: the three couplings above and the atomic balance update; the tests that prove the
  behaviour is unchanged (plus one that proves the lost update is gone).
- Out of scope: the multi-currency redesign (#33), multi-entry movements (#34), and every other
  module in the tree. No behaviour of the API changes.

## Approach

### 1. The date helpers move to a shared module

`addDays` and `isoDay` leave `bll/tasks/recurrence-engine.ts` and live in `types/dates.ts`, next to
the guards (the existing shared, dependency-free bucket). `recurrence-engine`, `dispute-matcher` and
whoever else uses them import from there; tasks keeps exporting nothing date-related of its own.

### 2. Finances stops knowing about the dispute intake

The intake is a **post-save step**, not part of saving:
`POST /finances/movements` answers the movement always, and the intake suggestion is attached by the
gateway, which is the composition layer and may know both domains:

- `FinancesService.createMovement` writes the movement and the balance, and returns the movement.
- The gateway controller calls `DisputesIntakeService.intakeFor(id)` afterwards and merges the
  answer (the intake failure stays logged and never turns a saved movement into a 500, as today).
- `finances.service` loses the `DisputesIntakeService` import entirely.

`FinancesService` still exposes the movement so the intake keeps working from where it belongs.

### 3. Calendar reads through the tasks service

`TasksService` gains the read the calendar needs (expectations inside a range, plus the puntual tasks
that started before it), so `calendar.service` talks to the domain instead of its repository. The
query stays the same (it already avoids N+1); it just moves one layer up, where a change in tasks'
storage cannot silently change calendar's output.

### 4. The balance becomes atomic

`FinancesRepository` gains an increment that does the arithmetic in SQL
(`amount = amount + delta`) and `FinancesService` uses it for both the create and the delete paths,
removing the read-modify-write. `setBalance` (the manual override of `POST /finances/balances`)
stays as it is: it is an absolute write on purpose.

## Acceptance criteria

- [ ] `finances.service` does not import anything from `disputes/`; the intake still answers on
      movement creation (same response shape, same tolerance to intake failures).
- [ ] `dispute-matcher` does not import from `tasks/`; its assertions stay green unchanged.
- [ ] `calendar.service` does not import `TasksRepository`; the calendar smoke stays green with the
      same payloads.
- [ ] Two interleaved movements against the same balance end with **both** deltas applied (the test
      fails on the previous code).
- [ ] Deleting a movement reverts its delta exactly once, including the double-delete case.
- [ ] No API contract changes: the five existing smoke suites that touch finances, calendar and
      disputes answer exactly as before.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- The full battery as it stands: 34 + 22 + 31 + 19 + 44 pure assertions and the nine HTTP smokes.
- One new pure assertion file (or an addition to an existing one) for the atomic increment: it needs
  a database, so the proof lives in a smoke instead - two movements created in parallel against the
  same key, then the balance checked against the sum of both.
- A grep-style check in the record: the three imports are gone (`from '../disputes/...'` in
  finances, `from '../tasks/...'` in the disputes engine, `TasksRepository` in calendar).

Result and measurements: `docs/records/025-domain-decoupling.md`.
