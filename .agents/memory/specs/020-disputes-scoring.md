# 020 Disputes scoring

> DRAFT: written before spec 019 is implemented, not committed on purpose. Depends on 019
> (links, disputes, candidates); anything 019 changes is adjusted here before this spec is
> committed and implementation starts.

## Objective

Turn the matcher from "declared category plus window" into a scorer that reads the full
metadata of both sides and the history of the task, so cases that today fall to a
consultation by default get an informed answer: two services of the same provider
(Personal internet / datos / flow), the same plan on two accounts (ChatGPT Plus in the
studies mail and in the work mail) and a subscription whose charge always lands two days
late. The engine does not replace the consultation with a guess: it replaces "here are two
candidates with no explanation" with "here are the candidates, this is how confident I am,
and this is the metadata that supports it".

## Scope

- In scope: the scoring signals over task and movement metadata plus the per-task history;
  confidence per candidate; the auto-link gate (score and margin) as an opt-in setting; the
  consultation panel payload with percentages; learning from confirmations; the aging of an
  unanswered consultation.
- Out of scope: everything 019 already does deterministically (declared link, window,
  consumption, dispute types and their resolution), the intake from finances and the system
  group (021), notifications and the engine panel (UI #24).

## Approach

### Signals and weights

| Signal | Source | Weight | Note |
|---|---|---|---|
| Declared category | `task_category_links` | gate | Already a hard gate in 019, not a score |
| Normalized name | task title vs movement description | high | Case and punctuation folded, `.com`, `s.a.`, accents removed: "NETFLIX.COM" matches "Netflix" |
| User or mail in metadata | task fields (title, description, note, sector) vs movement description and note | high | The `mixtan` case: the task says "ChatGPT Plus - mixtan" and the charge says `mixtan218` or the full mail; a substring match is enough |
| Learned date deviation | task history | medium | The 2.2-day average delay of that task: a candidate whose date is close to `expectedOn + average` scores higher than one on the exact date of a task that always pays late |
| Amount deviation | task price (fixed) or history amounts | medium | Within 15% scores full; beyond that it penalizes but never zeroes the candidate |
| Explicit category hint | movement note mentioning the service | medium | Covers the case where the metadata relation lives in the finances note |
| Recency of the task | task created/started date | low | Breaks ties between two tasks of the same provider |

The score is the weighted sum normalized to 0-100. Weights live in one module, not scattered:
`bll/disputes/scoring-weights.ts`, so tuning is a single file.

### Decision gate

- **Auto-link** (only when `disputes.auto_link` is on, default **off**): the best candidate
  scores >= 85 **and** beats the second by >= 25 points. The two conditions matter: a high
  score on two near candidates is a dispute waiting to happen, which is exactly the case the
  user described as "if the difference is minimal, ask".
- **Consultation**: everything else with candidates. The expectation goes to `suggestion`,
  and `dispute_candidates` stores each candidate with its score, its rank and the signals
  that contributed, in the order the panel shows them (candidate, percentage, metadata).
- **Aging**: an unanswered `suggestion` older than 14 days (setting
  `disputes.suggestion_age_days`) falls to a `missing` dispute, which is the honest reading:
  nobody confirmed it and no link exists.
- **No candidate**: unchanged from 019 (`missing`).

### History per task id

- `task_match_history`: one row per payment task with `averageDelayDays`, `sampleCount`,
  `lastAmounts` (jsonb, the last N amounts seen), `lastMatchedAt` and the signals that worked
  most often for that task.
- Feeding it: every confirmed link (automatic or manual) updates the row inside the same
  transaction that creates the link. A manual confirmation is worth more than an automatic
  one: it bumps `sampleCount` twice, because a human answer is the strongest signal available.
- Reading it: the scorer uses it only for the **active** task id. A cancelled task keeps its
  own history and is never used to match a new task, and a new task starts with an empty
  history: same name, different id, different history (the Edesur case, ids 78 and 133).
- A task with an empty history scores the metadata signals only; that is the cold start, and
  its outcome is usually a consultation, which is the intended first-run behaviour.

### Migration 0013 (additive)

- `task_match_history` as described above, keyed by `taskId` (unique).
- `dispute_candidates` gains `score` (integer, nullable so the 019 rows stay valid), `rank`
  (integer) and `signals` (jsonb: which signal contributed and how much).
- `settings`: `disputes.auto_link` (false), `disputes.auto_link_min_score` (85),
  `disputes.auto_link_margin` (25), `disputes.suggestion_age_days` (14),
  `disputes.amount_tolerance_percent` (15, the review-note threshold of 019 becomes a setting
  here instead of a constant).

## Endpoints

019 endpoints keep their shape; what changes is the payload:

```
GET  /disputes/candidates/:expectationId   each candidate now carries score, rank, signals
POST /disputes/:id/resolve                 { resolution: 'linked', candidateId }  confirms a
                                            suggestion; the confirmation feeds the history
GET  /tasks/:id/match-history              average delay, sample count, last amounts
GET  /disputes/settings                    effective values of the four settings
PUT  /disputes/settings                    patch them (auto_link, thresholds, aging)
```

## Acceptance criteria

- [ ] "NETFLIX.COM" in the movement description and "Netflix" as the task title gives a high
      score; with a second unrelated candidate in the window the best still wins by a margin
      that keeps it above the second.
- [ ] Two candidates at 43 and 37 stay as a consultation with both percentages, no auto-link,
      even with `auto_link` on (the margin rule).
- [ ] With `auto_link` on and one candidate at 92 with no second one, the link is created
      automatically and the history of that task is updated.
- [ ] A task whose history says it pays 2.2 days late scores the candidate landing on
      `expectedOn + 2` above the one landing exactly on `expectedOn`.
- [ ] `mixtan` in the task title matches a movement whose note contains `mixtan218` or the
      full mail.
- [ ] A cancelled task history is never used for a new task, and a new task with the same
      name starts with an empty history.
- [ ] Confirming a suggestion by hand raises `sampleCount` more than an automatic link does.
- [ ] An unanswered consultation older than 14 days falls to a `missing` dispute.
- [ ] `auto_link` off (default) keeps every consultation manual; turning it on only changes
      the >= 85 and >= 25 margin cases.
- [ ] The scorer never links a movement already consumed (019 rule) and never touches a
      resolution made by hand.

## Recorded for the next spec (021)

- Saving a movement in a service or subscription category: link it, ask whether it belongs to
  an existing task, or offer to create one with a pre-filled payload (title -> task, note ->
  detail, amount linked, category, user).
- System group `finances/`: flat, `is_system`, created at boot, never editable or deletable;
  subfolders are manual (supported, opt-in). Settings point the destination at any existing
  group; the engine works by group id, so rotating the destination leaves the old tasks where
  they are and only new ones land in the new group.

