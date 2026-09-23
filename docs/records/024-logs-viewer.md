# 024 Logs viewer - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this
file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **44 pure assertions** (`apps/backend/test/log-reader-asserts.mjs`) over a temporary directory:
  the naming rule (own names only, both streams, a look-alike name and a Windows path rejected);
  the listing (newest first, stream/date/segment/bytes separated, foreign names reported apart, a
  missing directory is not an error); the reading (filters by level, by several levels, by stream,
  by text case-insensitively, by reqId and by day range, all combined); the pagination (limit
  respected, cursor handed back, three pages walked without repeating or skipping a line, the
  corrupt line arriving as raw, the line still being written left for the next request); the tail
  (last lines, the mid-write line excluded, a foreign or missing file answering empty); and the
  cursor parser rejecting a foreign name or a negative offset.
- **39 HTTP checks** (`apps/backend/test/smoke-024-logs-viewer.mjs`): the backend compiled, up on
  `pyrite_test` with a seeded `LOG_DIR`, listing the seeded segments and the errors stream with the
  foreign file reported apart, reading the six seeded records of the range, every filter (level,
  several levels, stream, reqId, text, day range leaving other days out), pagination to the end
  without repeats, the tail, the raw download matching the file byte for byte, and the refusals:
  foreign name, other format, unknown level, bad date, bad cursor, zero lines, out-of-range limit.
- No regressions: the other four assertion files (34 + 22 + 31 + 19) and the eight previous smokes
  stayed green.

## Decisions taken while building

- **Polling, not streaming**: the front asks when the screen opens and refreshes; no WebSocket or
  SSE was introduced for this. The quick buttons the panel will show (day, week, month, custom)
  are the same `from`/`to` pair: the API only understands the explicit range.
- **The reader shares the naming rule with the retention**: `parseLogDate` is the single place that
  decides what a log file is, so a file the viewer serves is a file the purge knows about.
- **Tolerant by design**: a line that is not JSON comes back as `raw` instead of failing the
  request, and a line still being written is left for the next call (reading never returns a
  half-written entry).
- **The cursor is a byte offset**, so a page does not re-scan what a previous one already read, and
  a request is bounded twice (entries returned and candidate lines processed).

## Defects found and fixed while verifying

- **A file without a trailing newline could hang the read**: the read position was advanced only
  when a line was consumed, so the walk re-read the same bytes forever. The read position and the
  cursor position are now separate (the test caught it as a timeout).
- **The cursor could skip a whole file**: the walk ordered files by (date, segment) while the
  cursor compared names, and a segment repeated across streams (both `backend.*.2.log` and
  `errors.*.1.log` exist) made the resume skip a file. The walk and the resume now use the same
  (date, segment, name) comparison, verified with three files paginated in pages of two.

## Not verified

Live browser flow: the screen that lists the files, filters and tails is UI (#24).
