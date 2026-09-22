# 019 Disputes core

## Objective

Close the loop between tasks and finances. Up to now tasks produce materialized
expectations (a payment due on a date) and finances stores what actually happened, but
nothing compares them: a payment that never got registered, a payment made a week late and
an unplanned charge are all invisible. This spec builds the deterministic core of the
dispute engine: it links an expectation to its real movement when the answer is clear, opens
a persistent dispute when it is not, and asks the user instead of guessing whenever there is
any doubt. Scoring by metadata and history is the next spec; this one already stands on its
own because its default posture is to consult.

## Current state (pre-check before this spec)

- `task_expectations` (spec 015) holds one row per occurrence with `expectedOn`,
  `estimatedAmount` (nullable), `currency`, `tierPosition` and a status of
  `pending | settled | exception | cancelled`.
- `movements` (spec 005) holds the real money with `amount`, `amountCurrency`,
  `paidAmount`, `paidCurrency`, `rateUsed` (the immutable conversion snapshot),
  `balanceSource`, `categoryId`, `description`, `note`, `date` and `status`.
- `tasks` (spec 016) carries the payment payload in `task_payments` and can point at one
  expectation (`linkedExpectationId`), but there is no relation between a payment task and
  the finances categories its charges fall into.
- No worker exists for this domain: the only scheduled job is the rates sync (spec 006),
  whose pattern (run at boot plus a cron plus a manual endpoint) is the one reused here.

## Scope

- In scope: the declared link between a payment task and its finances categories; the
  matcher over the dual tolerance window; consumption of a movement by a single expectation;
  reconciliation links with the measured deviation; disputes of type `missing`, `late` and
  `unplanned` with their manual resolution; the worker (boot, nightly, manual endpoint);
  settings (`disputes.enabled`, the two tolerances) and the reversible `rebuild`; and the
  lookback of materialization, because without expectations of the recent past there is
  nothing to reconcile (see the note in the approach).
- Out of scope: the probabilistic scorer over metadata and history, percentage confidence
  and the auto-link threshold (spec 020); the creation of a task from a finances movement and
  the `finances/` system group (spec 021); notifications and the engine panel (UI, #24);
  projection-based plan deviation, balance drift and anomalous rates (recorded as v2, not
  built).

## Approach

### Migration 0012 (additive, no column dropped)

**A gap found before writing code**: materialization rolled only forward from today, so a
payment already due had no expectation to be compared against and the engine had nothing to
reconcile. `MATERIALIZATION_LOOKBACK_DAYS = 90` was added to the recurrence engine and the
window is now rolling on both sides: the recent past exists for the engine and the future for
the calendar. `occurrencesOf` itself did not change; only the window that tasks.service asks
for, which is why the pure assertions of the recurrence engine still hold.

- `expectationStatusEnum` gains `suggestion`: an expectation whose cases are ambiguous waits
  for a human answer instead of being forced into a decision.
- `dispute_type` enum: `missing`, `late`, `unplanned`.
- `dispute_status` enum: `open`, `resolved`.
- `dispute_resolution` enum: `cancelled`, `not_registered`, `paid_late`, `linked_manual`,
  `dismissed`.
- `task_category_links`: `taskId` + `categoryId` (unique pair). A payment task declares which
  finances categories its charges land in, and that declaration is the hard gate of the
  matcher. No declaration means the matcher does not guess: the expectation stays `pending`
  and can be linked by hand.
- `reconciliation_links`: `expectationId` (unique) + `movementId` (unique) + `matchedBy`
  (`declared` | `manual`), `amountDeviation` (numeric, nullable), `reviewNote` (text,
  nullable) and `createdAt`. Both sides are unique because a movement is consumed once and an
  expectation settles once.
- `disputes`: `type`, `taskId`, `expectationId` (nullable), `movementId` (nullable),
  `status`, `resolution` (nullable), `resolutionNote` (nullable), `evidence` (jsonb: the
  window used, the candidates seen), `detectedAt`, `resolvedAt`.
- `dispute_candidates`: `expectationId` + `movementId` (unique pair) + `reason` (text: which
  deterministic signals pointed here), `createdAt`. In this spec it carries the candidates of
  a consultation without a score; spec 020 fills a score column and a margin.


### The matcher (`bll/disputes/dispute-matcher.ts`, pure module, no DI)

One pass per run, over every payment expectation whose status is `pending` and whose
`expectedOn` is in the past:

1. **Window**: `[expectedOn - tolerance_before, expectedOn + tolerance_after]`, defaults 3
   and 7 days, both configurable as settings.
2. **Candidates**: active movements in that window whose category is declared by the task
   (`task_category_links`) and which are not already consumed by another link. Consumed is
   checked first: a movement links to one expectation only, which is what stops a payment
   made ahead of time from being eaten twice.
3. **No candidates and the window already closed** -> dispute `missing`, expectation to
   `exception`.
4. **Exactly one candidate** -> link it (`matchedBy: declared`). The amount is compared
   against `estimatedAmount` when that estimate exists and is fixed: a deviation over 15%
   does not invalidate the match, it is written to `reviewNote` for the human eye. A rotating
   price skips the comparison, which is the whole point of that mode.
5. **Two or more candidates** -> no guess: the expectation goes to `suggestion`, each
   candidate is recorded in `dispute_candidates` with the reason it was considered, and the
   answer is left to the manual endpoints. This is the default posture the design chose, so
   no confidence threshold is needed yet.
5b. **A movement after the closed window but before the next charge of the same task** ->
   the expectation is not reported as `missing`: the engine opens a `late` dispute naming
   both sides, because the honest question is "did you pay this late?" and not "did you drop
   the service?" (found while verifying: paying twelve days late is the real case the user
   described, and a `missing` dispute had no answer for it). `paid_late` resolves it by
   linking, and the window of the next charge is the ceiling: a movement beyond it belongs to
   that next charge, not to this one.
6. **A movement outside the window** reaches the expectation only through a manual link: the
   expectation settles and the link records the deviation, no dispute. Paying on day 12 is
   late, not missing.

The other direction: an active movement whose category is declared by a payment task, which
is linked to nothing and has no expectation of that task inside its window, becomes a dispute
of type `unplanned`. A movement already consumed by a link never produces one.

### Resolution flows (manual, recorded)

- `missing` asks the two real cases: `cancelled` (the service was dropped; the task is paused
  or deleted and its future expectations are cancelled) or `not_registered` (the payment
  happened and was never typed into finances; the expectation stays waiting for its movement,
  and the UI flow that pre-fills the charge is spec 021).
- `late` resolves with `paid_late`: the movement is linked to the expectation and the real
  deviation is stored.
- `unplanned` resolves with `linked_manual` (link it to an existing expectation, which also
  settles it) or `dismissed` (it was not a plan charge).
- `suggestion` resolves by picking one candidate (link, `matchedBy: manual`) or by dismissing
  the consultation: the expectation returns to `pending` and, if its window is closed, a
  `missing` dispute is opened instead.
- Manual always wins: the matcher never touches an expectation a human resolved and never
  rewrites a link created by hand.


### Worker, settings and reversibility

- `bll/disputes/disputes.service.ts` orchestrates one run: candidates -> decisions ->
  links/disputes. It is idempotent by construction (a settled expectation is skipped, a
  consumed movement is skipped, an open dispute for the same pair is not duplicated), so a
  second run changes nothing.
- Cadence, the pattern of the rates sync (spec 006): one run at boot, one nightly cron, and
  `POST /disputes/run` for a manual trigger. Each run is logged with its counts (candidates
  seen, links created, disputes opened).
- Settings (same service counts and rates already use): `disputes.enabled` (default `true`;
  `false` parks the worker and the manual run answers 409 while every existing row stays
  untouched), `disputes.tolerance_before` (3) and `disputes.tolerance_after` (7). The
  auto-link switch belongs to spec 020.
- `POST /disputes/rebuild` deletes automatic links and disputes and recomputes from scratch,
  preserving manual links, manual resolutions and resolved disputes. It is the "undo
  everything automatic" for when a tolerance or a declared category is fixed.

## Endpoints

```
GET    /disputes?type=&status=                list, newest detected first
GET    /disputes/:id                          one dispute with its evidence
POST   /disputes/:id/resolve                  { resolution, note?, movementId?, expectationId? }
GET    /disputes/candidates/:expectationId    the consultation of one expectation
POST   /disputes/links                        { expectationId, movementId }
DELETE /disputes/links/:expectationId         unlink (the movement frees up again)
POST   /disputes/run                          manual run (409 when disabled)
POST   /disputes/rebuild                      recompute everything automatic
GET    /tasks/:id/category-links              declared categories of a payment task
PUT    /tasks/:id/category-links              replace the declaration { categoryIds: [] }
```

## Acceptance criteria

- [ ] An expectation whose window closed with no movement produces a `missing` dispute and
      moves the expectation to `exception`.
- [ ] A movement two days before the expected date, in a declared category, settles the
      expectation with a link whose deviation is measured (paid early).
- [ ] A second run changes nothing: no duplicate link, no duplicate dispute.
- [ ] A movement in a declared category with no expectation inside its window produces an
      `unplanned` dispute.
- [ ] Two movements in the window leave the expectation in `suggestion` with both candidates
      recorded, and picking one settles it with `matchedBy: manual`.
- [ ] A fixed price of 20 USD matched against a 17 USD movement keeps the link and writes a
      review note instead of opening a dispute.
- [ ] A rotating price (no estimate) links without any amount comparison.
- [ ] Resolving `missing` as `cancelled` cancels the future expectations of the task;
      resolving it as `not_registered` leaves the expectation waiting.
- [ ] A movement already consumed by a link is never reused by another expectation.
- [ ] `disputes.enabled` in `false` makes the manual run answer 409 and leaves every row as
      it was.
- [ ] `rebuild` removes automatic links and disputes and keeps the manual ones.

## Recorded for the next specs (decisions already taken, not built here)

- **020, probabilistic scorer**: score over the full metadata of both sides (title,
  description, note, user or mail wherever it appears) plus the history of the task id
  (average delay learned from confirmed links, seen amounts, which signals worked), candidate
  percentages, and auto-link only when the best score is >= 85 and beats the second by >= 25;
  the true default stays "always consult", so `disputes.auto_link` is born off and only an
  installer who wants the differential turns it on. A consultation ages: unanswered for 14
  days it falls to a `missing` dispute. History belongs to the active task id: a cancelled
  task and a new one with the same name are different ids with different histories, and a
  stale or cancelled history never auto-links.
- **021, from finances to tasks**: saving a movement in a service or subscription category
  either links it, asks whether it belongs to a task, or offers to create one with a
  pre-filled payload (title -> task, note -> detail, amount linked, category, user). Plus the
  system group `finances/` (flat, `is_system`, created at boot, never editable) with the
  destination overridable in settings, and the engine always working by group id so rotating
  the destination keeps the old tasks alive where they are.
- **UI (#24)**: auto-links raise a side notification ("this payment was linked to X,
  task <-> finances") while any doubt is a modal; the engine section is for viewing,
  correcting and analysing links and histories only, with no metrics (those belong to the
  system dash, cached and recalculated on change).
- **v2 of the engine, not built**: plan deviation on top of the projection engine, balance
  drift, anomalous rates.

- [ ] Unlinking by hand frees the movement, which a later run may use.
