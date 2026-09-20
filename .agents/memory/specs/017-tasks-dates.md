# 017 Tasks fechas y horarios

## Objective

Give tasks their real time model. A punctual task stops being a single date and becomes a
list of dated entries: one entry is the simple format (start and end date plus an hour, the
task shows on every day of the range), and several entries are the multiple format (loose
dates, each with an optional hour and label). A recurring task gains selectable weekdays with
an optional hour per day, and the annual rule gains the switch that decides what happens when
February 29 does not exist in the target year. Hours are metadata: the calendar shows the day
either way and the hour is what the detail view and the future notifications read.

## Current state (pre-check before this spec)

- Spec 015 built the engine and the expectations; spec 016 built the ficha and the group
  tree. Today a punctual task materializes exactly one expectation on `starts_on`, and a
  recurring one only knows `frequency_unit` + `interval`, so weekly cannot express "mondays
  and wednesdays", and nothing can express an hour.
- `task_expectations` has no place for a time or a label, and the calendar reads only
  expectations, so both columns are needed to keep a single read path.
- The verification base is the 015 record (21 engine assertions and 18 HTTP checks) plus the
  016 record (17 HTTP checks).

## Scope

- In scope: `task_dates` (simple, range and multiple with hour, end hour and label),
  `task_weekdays` (selected days with hour per day), the annual leap-day switch, the engine
  extension for both, `scheduled_time`/`time_to`/`label` on expectations, and the calendar
  entries carrying them.
- Out of scope: notifications and reminders (feature #27), payments v2 (018), the UI (#24),
  the alert that a payment was settled on a different day than expected (that is the
  reconciliation of 018).

## Approach

Migration 0010, additive:

- `task_dates`: `id`, `task_id` (FK cascade), `date`, `date_to` nullable (a range shows every
  day between the two), `time` nullable, `time_to` nullable (a time range such as 08:00 to
  14:00) and `label` nullable (free text of that entry). One row is the simple format; a row
  with `date_to` is a range; N rows are the multiple format, with no limit.
- `task_weekdays`: `id`, `task_id` (FK cascade), `weekday` (ISO, 1 = Monday), `time`
  nullable, `time_to` nullable, unique per (`task_id`, `weekday`). A single hour among the
  rows acts as the global one for the days without their own.
- `task_recurrence` gains `leap_day_mode` (`feb28` | `mar01`, default `feb28`): what the
  annual rule does when the anniversary falls on February 29 and the year is not a leap year.
- `task_expectations` gains `scheduled_time`, `time_to` and `label` (all nullable): the
  materialized occurrence carries what the calendar has to show, so the view keeps reading a
  single source and never re-evaluates a rule.
- `tasks.starts_on` stays and becomes a derived value: for a punctual task with dates it is
  the earliest one (it is what the list orders by), and for the rest it is still an input.
- Engine:
  - Punctual: occurrences come from `task_dates`, expanding a range day by day, each carrying
    its time, end time and label. `startsOn` alone (no dates) keeps working as the single
    entry, so nothing existing breaks.
  - Weekly: within each week step of the interval, emit only the selected weekdays. The
    interval is anchored to the week of the first charge, so "every 2 weeks" means one week
    with the task and one without, never a drifting cycle.
  - Annual: when the computed day is February 29 and the year has no such day, `leap_day_mode`
    decides between February 28 (stay in the month) and March 1.
- Calendar: an entry exposes the scheduled time, the end time and the label, and a punctual
  range shows on every day it covers.

## Endpoints

The task payload grows, nothing else moves:

```
POST /tasks   { type: 'puntual', dates: [{ date, dateTo?, time?, timeTo?, label? }], ... }
POST /tasks   { type: 'recurrente', recurrence: { frequencyUnit: 'week',
                weekdays: [{ weekday: 1, time: '08:00' }, { weekday: 3 }], ... } }
GET  /calendar?from=&to=       each entry carries scheduledTime, timeTo and label
```

## Acceptance criteria

- [ ] A punctual task with a single entry and a range shows on every day it covers.
- [ ] A punctual task with three loose dates shows on exactly those three days.
- [ ] The hour and the label of an entry travel to the expectation and the calendar.
- [ ] A weekly task with two selected days appears on both, every week.
- [ ] With interval 2 the weekly task appears one week yes and one no, on the selected days,
      anchored to the start (never a drifting cycle).
- [ ] Each selected day can carry its own hour; with one hour only, the rest inherit it.
- [ ] An annual task on February 29 falls on February 28 with `leap_day_mode = feb28` and on
      March 1 with `mar01`, and only in non-leap years.
- [ ] A task without dates or hours behaves exactly as today (015 criteria still green).
- [ ] Re-materializing after an edit does not duplicate and never rewrites the past.
- [ ] `npm run tsc` and `npm run build` pass (strict).

## Verification (planned)

- Migration review (0010, additive) and apply in `pyrite` and `pyrite_test` by psql.
- Engine assertions extended with the four cases above; the existing 21 keep passing.
- HTTP smoke over the 016 harness: create the multi-date punctual, the weekly with two days
  and per-day hours, the biweekly and the February 29 cases, then read the range and compare
  the days, hours and labels.
- No regression: 016 smoke (17 checks) and 015 smoke (18 checks) in green.
- Verification record: `docs/records/017-tasks-dates.md`.
