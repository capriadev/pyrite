# 024 Logs viewer

## Objective

Read-only access to the backend log files for the front: list what is on disk, read entries with
filters (stream, level, text, reqId, date range), page through them without loading whole files,
tail the latest lines and download a file raw. The viewer is stateless and pulls on demand: the
front asks when the screen opens and refreshes. No streaming channel is introduced here.

Reading never re-exposes anything sensitive: the logger redacts at write time (011), so the files
already hold what may be shown.

## Current state (pre-check before this spec)

- `services/logger`: pino writes JSON Lines to `logs/backend` in two rotating streams,
  `backend.YYYYMMDD.N.log` (everything at the active level) and `errors.YYYYMMDD.N.log` (warn and
  error only), with `time`, `level`, `msg`, `context` and `reqId` per record.
- `bll/logs/log-retention.ts` (023) already owns the naming knowledge (`LOG_FILE_PATTERN`,
  `parseLogDate`) and the rule that only logger files are touched. The reader reuses it instead of
  defining a second interpretation of the same names.
- `bll/logs/logs.service.ts` (153 lines) is retention only; `gateway/logs` exposes the purge
  endpoints. Nothing reads the files.

## Scope

- In scope: a pure reading module (listing, tolerant line parsing, filters, byte-cursor
  pagination, tail); four read endpoints on the existing logs controller; the caps that keep one
  request from reading everything; the raw download.
- Out of scope: streaming (WebSocket or SSE), any UI, retention changes, logs of other processes
  (sidecars get their own tree later), and anything that writes.

## Approach

### The reader, pure

`bll/logs/log-reader.ts`, no Nest and no database, testable against a temporary directory:

- `listLogFiles(dir)` returns one entry per file that follows the logger naming: stream (the name
  before the date), date (from `parseLogDate`), segment, bytes and mtime. Anything else is
  reported apart and never served.
- `readEntries(dir, query)` walks the selected files in date order, parses each line tolerantly (a
  valid JSON line becomes structured fields; a broken or half-written line stays as `raw`), and
  applies the filters.
- Filters: `stream`, `level` (one or more), `q` (case-insensitive substring over msg and context),
  `reqId`, and a date range that selects files by the date in their name: a single day, a week, a
  month, a custom range or everything are all the same `from`/`to` pair, so the quick buttons are
  the front's business.
- Caps and cursor: one request returns at most `limit` entries and processes at most `maxLines`
  candidate lines, and answers with `nextCursor`. The cursor is a byte offset, so continuing does
  not re-scan what was already read and a long search becomes several cheap requests.

### The service and the endpoints

`LogsService` grows the read side: validation (a nonsense parameter is a 400), the guard that a
requested name is a logger file with no path separators, and the mapping of the query to the
module.

- `GET /logs/files` - the listing (streams, dates, segments, sizes, totals).
- `GET /logs/entries?stream=&level=&q=&reqId=&from=&to=&limit=&cursor=` - the filtered page.
- `GET /logs/tail?file=&lines=` - the latest lines of one file.
- `GET /logs/files/:name/raw` - the file as `text/plain` for download.

The file of today is read while the roller holds it open: a sharing error on Windows degrades to
what was read so far, never to a 500.

## Acceptance criteria

- [ ] The listing returns only logger files, with stream, date, segment and size, and reports
      foreign names apart.
- [ ] Entries honor every filter combined (stream + level + text + reqId + range) and come back in
      date order.
- [ ] A page never exceeds its caps and `nextCursor` continues exactly after the last returned
      line, without repeating or skipping.
- [ ] `tail` returns the requested number of lines without loading the whole file into memory.
- [ ] A name with separators, or one that is not a logger file, is refused: no path escape.
- [ ] A half-written or corrupt line does not break the read.
- [ ] The download returns the exact bytes of the file.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- Pure assertions (`test/log-reader-asserts.mjs`) over a temporary directory: naming, filters,
  cursor continuity, tolerant lines, tail, foreign rejection.
- HTTP smoke (`test/smoke-024-logs-viewer.mjs`): the backend up with a prepared `LOG_DIR` (like
  023), the four endpoints end to end, including a truncated file and the raw download.
- No regressions in the existing assertions and smokes.

Result and measurements: `docs/records/024-logs-viewer.md`.
