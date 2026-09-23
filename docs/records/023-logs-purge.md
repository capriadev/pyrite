# 023 Logs purge - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this
file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **19 pure assertions** (`apps/backend/test/log-retention-asserts.mjs`), over a temporary
  directory and with an injected clock: the name decides (own naming only, the errors file
  included, a foreign name and an impossible date rejected); the plan (older than the window goes,
  inside stays, today never goes, a foreign file is marked apart, a file touched a minute ago is
  kept even when its name says otherwise); and the real work on disk (exactly the expired files
  removed, bytes measured, the rest untouched, a missing directory is not an error).
- **23 HTTP checks** (`apps/backend/test/smoke-023-logs.mjs`), all green: the boot pass recorded
  with origin `boot` and its files and bytes, the survivor staying on disk, the settings read back
  and validated (120 / 24 defaults, a 400 for a nonsense value), the manual pass recorded with
  origin `manual` and using the configured retention, the interval not firing while it is far, the
  retention change taking effect without a restart, the history newest first with its limit, and
  the summary adding up runs, files and bytes.
- No regressions: the other three assertion files (34 + 22 + 31) and the seven previous smokes
  stayed green.

## Decisions taken while building

- **The trigger is an interval, not a fixed hour**: the spec started as "nightly" and became
  "whatever the user configures", which is why the pass reads the clock from the last recorded
  run instead of holding a timer of its own. That is also what makes the interval survive a
  restart and change without rescheduling anything.
- **The record is both the metrics and the clock** (one table, two uses), which is what the user
  asked for: files, bytes and when, per run, broken down by origin.
- **The trigger and the data stay on the backend side**: the logs are the backend's even when the
  front runs on another machine, so the front only reads the history.
- **The old purge left the logger**: `LoggerService.init()` no longer purges; the boot pass runs
  through the same service as the others, which is what makes it recorded.

## Recorded for later

The **logs viewer** for the front (list, filter by level and date, tail) is its own feature: it is
reading, not retention, and it needs endpoints the purge does not. It is not registered in the
index yet, to avoid touching the numbering while the 022 branch is still open.

## Not verified

Live browser flow: the screen that shows the history and the totals is UI (#24).
