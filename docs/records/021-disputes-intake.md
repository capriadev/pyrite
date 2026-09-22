# 021 Disputes intake - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this
file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **30 HTTP checks** (`apps/backend/test/smoke-021-intake.mjs`), all green: the system group
  `finances/` existing and marked, refusing both the rename and the delete; an ordinary purchase
  producing no question; a movement in a declared category linking the moment it is saved
  (flagged as automatic); a declared category with no expectation there returning
  `existing_task` with the right task id; a service category with no payment task offering a
  draft whose title, note, amount, currency, date, destination and category all come from the
  movement; confirming the creation leaving the task inside `finances/`, settling the
  expectation the new series generated and declaring the category so the second charge links by
  itself; a dismissal being remembered; confirming an existing task linking to its nearest open
  expectation; the destination rotating with the setting and falling back to the system group
  when the configured one does not exist; and the boundary answers (invalid kind, invalid
  movement, invalid group id).
- No regressions: the whole battery of the front stayed green - 34 assertions of the recurrence
  engine, 22 of the matcher, 31 of the scorer and the seven smoke tests.

## The interaction with 019 and 020 (and what it forced)

The engine now links a movement when it is saved, so the pass is no longer the only link in the
chain. That was not free:

1. **A real gap appeared**: the intake linked without measuring anything, so the amount
   deviation and the review note that spec 019 promised were lost on the most common path. The
   measurement moved to a shared `linkReview` in the matcher, which the intake and the pass now
   share, so both paths record exactly the same thing.
2. **The smoke tests of 019 and 020 had to move the moment of the declaration**: their
   two-candidate scenarios (a consultation, a tie, a tight margin) need the candidates to exist
   when the pass runs, and with the intake linking on save the first one won. Creating the
   movements before declaring the category restores the scenario's intent without weakening the
   assertion. This is a harness change, not a behaviour change of those specs.

## Deviations from the spec, recorded

- `categories.is_service` was added: the spec spoke of "a service or subscription category" and
  nothing in the schema said what that was (documented in the spec before committing).
- `dispute_intake_dismissals` was added for the same reason: "remember the movement" needed a
  place to live.
- The link path shares `linkReview` with the matcher instead of duplicating the threshold.

## Not verified

Live browser flow: the modal that shows the draft and the side notification are UI (#24).
