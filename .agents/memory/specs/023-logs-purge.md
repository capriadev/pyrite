# 023 Logs purge

## Objective

Log retention today happens once, at boot: `LoggerService.init()` calls a private `purgeExpired()`
that deletes files older than the retention window. A backend that is meant to run for weeks
therefore purges only when someone restarts it, and one that restarts daily purges far more often
than it needs to. This spec gives retention its own dedicated pass: it runs at boot, on a
configurable interval, and on demand, and it leaves a record of every run so the freed space can
be measured.

It also settles where the trigger lives. The frontend may run on another machine, but the logs are
the backend's: the trigger and the data are always on the backend side, and the front only reads
what its endpoints expose.

## Current state (pre-check before this spec)

- `services/logger/logger.service.ts`: `init()` calls the private `purgeExpired()` once; the file
  work (read the directory, parse the date from `name.YYYYMMDD.N.log`, unlink what is older) lives
  inside the logger, untestable without boots and untouched by any schedule.
- `services/logger/logger.config.ts`: `retentionDays` comes from `LOG_RETENTION_DAYS` (default
  120). Nothing else is configurable and nothing is recorded.
- The scheduler pattern already exists twice (`RatesSchedulerService`,
  `DisputesSchedulerService`): a boot run, a periodic tick and a manual endpoint, with the gate
  read from settings so a parked feature runs nothing.

## Scope

- In scope: the retention as its own module and service; the per-run record (files, bytes, trigger
  and retention used); three triggers (boot, interval, manual); the settings for retention days
  and interval; the reading endpoint for the history; the protections around what may be deleted.
- Out of scope: reading logs (listing, tail, filters) - that is the viewer for the front and
  belongs to its own feature; compression, shipping logs elsewhere, and the dashboard.

## Approach

### The pass, in a pure module

`bll/logs/log-retention.ts` holds the file logic with no Nest and no database, so it is testable
against a temporary directory:

- `parseLogDate(name)` understands exactly the naming the logger produces
  (`backend.20260922.3.log`, `errors.20260922.1.log`) and returns null for anything else.
- `planPurge(entries, { retentionDays, now, minAgeHours })` decides what goes, and it is the place
  where the protections live: only its own naming, never the file of today, never one modified in
  the last hours even if its date says otherwise.
- `purgeLogs(dir, options)` does the work and returns `{ files, bytes, skipped }`, measuring each
  size before removing it. A locked or missing file is counted as skipped, never as a failure.

### The service and the record

`bll/logs/logs.service.ts` resolves the configuration, calls the module and **records the run**
before returning. The record is the clock of the interval and the source of the metrics:

- `dal/logs/log-purge.repository.ts` touches the new table; the service decides.
- `log_purge_runs`: `id`, `startedAt`, `finishedAt`, `origin` (`boot` | `interval` | `manual`),
  `retentionDays`, `files`, `bytes`, `skipped`, `dir`.
- `POST /logs/purge` returns the run; `GET /logs/purges?limit=` returns the history newest first,
  and `GET /logs/purges/summary` the totals (runs, files, bytes) - what the front will show.

### Triggers

- **Boot**: one run on application bootstrap, through the same service, so the boot purge is
  recorded like any other.
- **Interval**: a scheduler checks hourly and runs only when the configured interval has elapsed
  since the last recorded run. Reading the clock from the table is what makes it survive a restart
  and what makes an interval change take effect without rescheduling anything.
- **Manual**: the endpoint above.

### Settings

`logs.retention_days` (default 120, the current value) and `logs.purge_interval_hours` (default
24) live in settings, so the panel can change them; the `.env` values stay as the boot defaults.

## Acceptance criteria

- [ ] A boot run leaves a `log_purge_runs` row with origin `boot`.
- [ ] The interval run happens only when the elapsed time since the last recorded run exceeds the
      configured hours: with the interval set to a large number, a tick does nothing.
- [ ] `POST /logs/purge` runs immediately and returns files and bytes, and the row is recorded.
- [ ] `GET /logs/purges` returns the history newest first and `GET /logs/purges/summary` the
      totals.
- [ ] Files older than the retention window are removed; files inside it stay.
- [ ] The file of the current date is never removed, and neither is a recent file whose name says
      otherwise.
- [ ] A file that does not follow the logger naming is never touched.
- [ ] A locked file is skipped without failing the run.
- [ ] `logs.retention_days` and `logs.purge_interval_hours` are validated: a nonsense value falls
      back to the default instead of breaking the retention.
