# 022 Disputes service split - verification record

Snapshot of what was measured when the refactor closed. The spec is the technical record; this
file is the evidence.

## Result

| File | Before | After |
|---|---|---|
| `disputes.service.ts` | 775 | **159** |
| `dispute-pass.service.ts` (new) | - | 447 |
| `dispute-resolutions.service.ts` (new) | - | 149 |
| `dispute-engine-settings.service.ts` (new) | - | 99 |
| `dispute-params.ts` (new) | - | 24 |

The domain now reads as: the matcher and the scorer are pure, the repository is the only layer
that touches tables, the pass is the engine's brain, the resolutions are the human answers, the
settings service is the panel's surface, and `disputes.service.ts` is the facade the gateway and
the scheduler talk to (reads, maintenance, category declarations, and a thin `run` that
delegates).

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **The whole battery, untouched and green**: 34 assertions of the recurrence engine, 22 of the
  matcher, 31 of the scorer, and the seven smoke tests (154 HTTP checks) - including the
  resolution flows of 019, the scoring decisions of 020 and the intake of 021. A refactor with no
  behaviour change is proved by exactly this: not one assertion had to move.
- The application boots with the new wiring (the smoke tests start it and answer `/health`).

## Deviation from the spec

The spec's table left the pass inside `disputes.service.ts` and estimated the file at ~420 lines.
With the resolutions and the settings out, the file was still 574, so the pass was extracted too
(`dispute-pass.service.ts`, 447 lines) and what stayed became a facade of 159. The target of the
acceptance criterion (under 450) was met with margin and the split is cleaner than planned: the
four responsibilities the debt note listed now have four files, plus the shared validations.

## A real defect the split surfaced

Two of the new services were first written with `import type` for the injected classes. Type-only
imports are erased at compile time, so Nest could not resolve the dependencies at runtime and the
app refused to boot (`Nest can't resolve dependencies of DisputePassService`). It never reached a
commit: the smoke tests caught it on the first run, and the fix is a value import for anything
`@Injectable` that is injected. Worth remembering - it is the kind of failure `tsc` is happy with.

## Not verified

Nothing new to verify: this spec changed no behaviour, no route and no schema. The UI of the
engine (#24) is still the pending piece of the domain.
