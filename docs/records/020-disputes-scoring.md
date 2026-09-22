# 020 Disputes scoring - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record;
this file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **31 pure assertions** of the scorer (`apps/backend/test/scorer-asserts.mjs`): normalization
  (dots, case, accents), short tokens as noise, name affinity exact and partial, metadata
  affinity part by part (the mail and its user token), amount fit against an estimate and
  against the learned amounts, neutral signals on a cold start, the learned delay weighing the
  date, ranking with signals, and the auto-link gate (off by default, near tie consults,
  enough margin links, single candidate under the threshold consults). The weights are asserted
  to sum 100.
- **25 HTTP checks** (`apps/backend/test/smoke-020-scoring.mjs`), all green: the defaults of the
  engine, the consultation carrying score, rank and four signals per candidate, the switch off
  keeping the doubt as a consultation, the switch on linking when the advantage is real, the
  history learning from an automatic link (one sample) and from a human answer (two samples,
  the strongest signal), the tight margin still consulting, the aging of an unanswered
  consultation into a missing dispute, and the validation of settings (negative tolerance,
  invalid boolean, out-of-range aging all answer 400).
- No regressions: 34 assertions of the recurrence engine, 22 of the matcher, 38 HTTP checks of
  019 and the four smokes of the tasks front (15 to 18) still green.

## Decisions that shaped the code

- The auto-link gate needs **both** conditions: score over the threshold and a margin over the
  second candidate. A high score on two near candidates is a dispute waiting to happen, which
  is the case the user described as "if the difference is minimal, ask".
- The switch is born **off**: consulting is the engine's posture, and the automatic mode is the
  differential whoever wants it turns on.
- History belongs to the **task id**, never to the name, and a human answer weighs double.
- `suggestion_age_days` accepts 0: it means a consultation does not wait at all, which is what
  the verification used to age one without touching the database.

## Deviation from the spec

The spec proposed `disputes.amount_tolerance_percent` as the home of the 15% review threshold
of 019; it is implemented that way and read by both specs. The candidate swap (full replace of
a consultation) was added as a repository operation because the scores change on every pass.

## Debt noticed (for a later spec, not fixed here)

`bll/disputes/disputes.service.ts` closed this spec at 776 lines. It is not tangled - the pass,
the resolutions, the maintenance and the settings are separate sections - but the repo's own
rule says a huge file is a design failure. The split that would pay off, when a spec is opened
for it: the resolution flows and their validation helpers as their own module, and the settings
surface as a third, leaving the service with the pass and the reads.

Also worth noting: the settings endpoints live in the disputes controller while the history
endpoint lives in tasks, which is fine but asymmetric; a single read surface for the engine
panel (#24) may want them together.

## Not verified

Live browser flow: the engine panel, the side notification of an automatic link and the
settings screen are UI (#24) and are not built.
