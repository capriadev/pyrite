# 019 Disputes core - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record;
this file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **22 pure assertions** of the matcher (`apps/backend/test/matcher-asserts.mjs`): the dual
  window, signed date and amount deviations, settle with a single candidate, review note over
  the threshold, rotating price without comparison, consultation with two candidates, consumed
  movement ignored, closed window as missing, open window as waiting, late candidate bounded by
  the next charge, and the unplanned rules (covered by a waiting expectation, consumed, or
  already claimed by a late dispute).
- **38 HTTP checks** (`apps/backend/test/smoke-019-disputes.mjs`), all green: missing opens a
  dispute and leaves the expectation in exception; a second pass opens nothing twice; a
  movement inside the window settles with its deviation measured; a 25% deviation keeps the
  link and writes the review note; a rotating price links without comparing; two candidates
  leave the expectation in consultation and answering settles it as manual; a movement nobody
  expected opens unplanned; a payment past the window opens `late`; resolving paid late links
  and closes; cancelling pauses the task and cancels its future; not registered leaves the
  expectation waiting; one movement pays one expectation only; unlinking frees the movement
  and returns the expectation to waiting; the switch answers 409 and leaves every row as it
  was; rebuild removes the automatic work and keeps the manual answers; a resolution that does
  not apply to a type answers 400; an unknown category answers 404.
- No regressions: 34 assertions of the recurrence engine and the four previous smokes
  (calendar 18, organization 17, dates 15, payments 11) still green.

## Two defects found and fixed while verifying

1. **The past did not exist.** Materialization rolled forward only, so an already due payment
   had no expectation and the engine could never reconcile it. Added
   `MATERIALIZATION_LOOKBACK_DAYS = 90` and the materialization window is now rolling on both
   sides. Nothing of the pure recurrence engine changed, so the 015-018 assertions held.
2. **Late payments had no question.** The user's own case (paying the 20th on the 2nd) was
   reported as `missing`, whose answers are cancelled / not registered. The pass now looks for
   a movement after the closed window and before the next charge, and opens a `late` dispute
   naming both sides, resolved with `paid_late`.

Also fixed on the way, found by the same smoke: the finances API received `date` as a string
from any JSON client and passed it straight to the driver, which answered 500. The service now
validates and converts it (400 on a malformed value).

## Deviation from the spec

Two additions are recorded in the spec itself because implementation had not been committed
yet: the late-detection step (5b) and the materialization lookback. Both are answers to
acceptance criteria that could not be met otherwise, not new objectives.

## Not verified

Live browser flow: the engine panel and the notifications are UI (#24) and are not built.
