# 022 Disputes service split

## Objective

`bll/disputes/disputes.service.ts` closed spec 021 at 775 lines. The reading is the only layer
that was never split, and it now carries something of everything: the pass, the resolution flows
with their validations, the maintenance, the settings surface and the reads. The repo's own rule
says a huge file is a design failure, so this spec splits it by responsibility without changing
one line of behaviour: the whole existing verification battery is the proof that nothing moved.

## Current state (pre-check before this spec)

- `disputes.service.ts` (775 lines): `run` and its internals, the pass helpers (`movementsFor`,
  `historyFor`, `rank`, `learn`, `ageConsultations`, `openMissing`, `openLate`, `openUnplanned`),
  the reads (`list`, `get`, `candidatesOf`, `linkOf`, `matchHistory`), the resolution flows
  (`resolve`, `decideSuggestion`, `link`, `unlink`), the maintenance (`rebuild`,
  `categoryLinks`, `setCategoryLinks`) and the settings surface (`engineSettings`,
  `updateEngineSettings` with its validators).
- The neighbouring pieces are already separated and stay as they are:
  `dispute-matcher.ts` and `dispute-scorer.ts` (pure), `disputes.repository.ts` (491 lines, one
  layer with one job), `disputes-intake.service.ts` (281 lines, its own flow).
- The gateway already injects two services (`DisputesService` and `DisputesIntakeService`), so
  adding two more follows the same shape and touches no route.

## Scope

- In scope: moving the resolution flows and their validations to `DisputeResolutionsService`, the
  settings surface to `DisputeEngineSettingsService`, the few helpers they share to a tiny
  `dispute-params.ts`, and the module wiring. Sizes, not behaviour.
- Out of scope: any behaviour change, any endpoint change, any schema change, and the rest of the
  domain (`run`, the pass, the reads, the maintenance and the category declarations stay where
  they are).

## Approach

| Module | Responsibility | Roughly |
|---|---|---|
| `dispute-params.ts` | the validations both services share: an id, a task status | ~30 lines |
| `dispute-resolutions.service.ts` | `resolve`, `decideSuggestion`, `link`, `unlink` and the table of which resolutions each dispute type accepts | ~200 lines |
| `dispute-engine-settings.service.ts` | the effective settings and their patch, with the boolean and counter validators | ~120 lines |
| `disputes.service.ts` | the pass, its internals, the reads and the maintenance | ~420 lines |

Coupling is one way and stays that way: the resolutions service depends on the engine service for
the single thing they genuinely share - reporting an expectation as missing when a consultation
expires - through one public method instead of a copy of the evidence shape. The engine service
does not know the resolutions service exists, so there is no cycle to wire around.

The routes keep their paths and their bodies; only the class that answers them changes:

```
POST   /disputes/:id/resolve                  -> DisputeResolutionsService
POST   /disputes/suggestions/:id/decide       -> DisputeResolutionsService
POST   /disputes/links, DELETE /disputes/links/:id -> DisputeResolutionsService
GET    /disputes/settings, PUT /disputes/settings  -> DisputeEngineSettingsService
```

## Acceptance criteria

- [ ] `disputes.service.ts` stays under 450 lines and the three new files exist with the
      responsibilities of the table.
- [ ] Not one behaviour changes: the full battery passes untouched - 34 assertions of the
      recurrence engine, 22 of the matcher, 31 of the scorer and the seven smoke tests (154 HTTP
      checks), including the resolution flows of 019, the scoring decisions of 020 and the intake
      of 021.
- [ ] `npm run tsc` and `npm run build:backend` stay clean.
- [ ] The module exports the two new providers and the gateway consumes them, with no route
      added, removed or renamed.
- [ ] No file of the domain keeps a duplicated helper after the move: the resolution table and
      the validators exist once.
