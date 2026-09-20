# 018 Tasks pagos v2

## Objective

The free trial of a payment stops being "days only". A trial is a count plus a unit
(day, week or month), so "one month of trial" is expressible as one month and not as thirty
days, and the first charge lands on the same day of the following month instead of drifting
with the calendar. The rest of the payment payload already covers the real cases (optional
price, fixed or rotating, tiers for the promo that becomes a regular price, installments for
a finite series), so this spec only touches the trial.

## Current state (pre-check before this spec)

- `task_payments` stores `trial_days` (integer, default 0) and the engine derives the first
  charge as `startsOn + trial_days`; everything else of the payload (mode, price, currency,
  installments) is used as is.
- The v1 modal offered a fixed list of trials (1, 3, 7, 14, 15 or 30 days); the new form asks
  for a unit and a quantity, which is the reason of this change.
- Only test data exists in `task_payments` (the feature is not in use yet), so the column
  conversion carries no production data.

## Scope

- In scope: `trial_days` becomes `trial_count` + `trial_unit`; the engine adds the trial in
  the chosen unit; the API renames the field and rejects the old one explicitly; the
  verification of the conversion.
- Out of scope: notifications (#27), the UI (#24), the reconciliation of payments, and the
  rest of the payment payload, which needs nothing new.

## Approach

Migration 0011, with one flagged statement:

- `trial_unit` enum (`day`, `week`, `month`).
- `task_payments`: `trial_count` integer not null default 0 and `trial_unit` of the new enum
  not null default `day`.
- **Data move, then drop**: `UPDATE task_payments SET trial_count = trial_days` before
  `ALTER TABLE task_payments DROP COLUMN trial_days`. Every existing value survives as days,
  which is what it meant; the drop is the only destructive statement of this migration and is
  the reason the generated `.sql` is shown for confirmation before applying.
- Engine: `firstChargeDay` adds the trial in its unit (weeks are 7 days, months go through the
  calendar arithmetic that already clamps to the last day of the target month, so a payment on
  the 31st is not pushed into the next month).
- API: `payment.trialCount` and `payment.trialUnit` replace `payment.trialDays`; sending the
  old field answers 400 with a message naming the replacement, so a stale client fails loudly
  instead of silently charging on the wrong day.
- Recorded for the future UI: "cuotas / fija" in the modal maps to mode `cuotas` with
  `installmentsCount` (a finite series) while a one-off purchase is mode `fija`; and the
  price change (the Canva case) is the existing `task_price_tiers` sequence, so the modal
  never needs a second task for it.

## Endpoints

The payload changes one field, nothing else moves:

```
POST /tasks  { type: 'pago', startsOn, payment: { mode: 'recurrente', trialCount: 1,
               trialUnit: 'month', ... } }
```

## Acceptance criteria

- [ ] A trial of 14 days shifts the first charge by exactly 14 days.
- [ ] A trial of 2 weeks shifts the first charge by 14 days as well.
- [ ] A trial of 1 month on the 31st of January lands on the last day of February, not on
      March 3rd.
- [ ] A trial of 0 charges on the start day itself.
- [ ] Installments mode keeps ignoring the trial, as before.
- [ ] Sending `trialDays` answers 400 naming `trialCount` and `trialUnit`.
- [ ] The migration moves every existing `trial_days` value into `trial_count` with unit
      `day`, and only then drops the column.
- [ ] The 015 and 017 criteria on trials (a 14 day trial and a 30 day trial) still hold with
      the new fields.
- [ ] `npm run tsc` and `npm run build` pass (strict).

## Verification (planned)

- Read the generated `0011` migration in full and show the `DROP COLUMN` before applying;
  apply by psql in `pyrite` and `pyrite_test` only after the explicit confirmation.
- Count rows and values before and after in the test database (`trial_count` equals the old
  `trial_days` for every row).
- Engine assertions: the four trial cases above, plus the existing 30 as green.
- HTTP smoke: a subscription with one month of trial and another with two weeks, checking the
  first expectation date; and the 400 on the old field.
- No regression: the 016 and 015 humos in green.
- Verification record: `docs/records/018-tasks-payments-v2.md`.
