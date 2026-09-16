# 011 Logging system

## Objective
Give Pyrite a real logging system: structured JSON Lines records written to disk with
correlation ids, automatic redaction, level control, size+date rotation and retention, so
that any failure can be traced (what failed, where and how) without reproducing it.

## Scope
- `pino` as the logging core, installed in `apps/backend`.
- `pino-pretty` for human-readable console output in dev only.
- Wrapper in `apps/backend/src/services/logger/` (config, service, request context,
  HTTP interceptor).
- Global registration so every existing Nest `Logger` usage goes to disk unchanged.
- Migration of the loose `console.log` and instrumentation of business events in
  auth, notes, groups and crypto.
- CI: add `build` for backend and frontend.

## Scope boundaries
- No frontend or bot-discord loggers yet: their folders are created empty when those
  processes exist.
- No remote log shipping, no log parsing/query tooling, no dashboards.
- No logging of request bodies by default (see redaction rule).

## Layout

```
logs/
├── backend/
│   ├── backend.YYYYMMDD.1.log      every record at the active level (JSON Lines)
│   ├── backend.YYYYMMDD.2.log      next file for the same day after the size ceiling
│   ├── backend.YYYYMMDD.3.log      and so on (incremental number, no padding)
│   └── errors.YYYYMMDD.1.log       warn and error records only (duplicated)
├── frontend/                       (empty for now, .gitkeep)
└── bot-discord/                    (empty for now, .gitkeep)
```

- Naming: `name.YYYYMMDD.N.log`, produced by pino-roll with
  `frequency: 'daily'` plus `dateFormat: 'yyyyMMdd'` over a file named `name`.
  The date segment makes rotation by day implicit (a new day opens a new file
  set); `N` increases when the size ceiling is reached.
- Size ceiling: 100 MB per file (`LOG_MAX_FILE_SIZE`, default `100m`). pino-roll
  size syntax: a bare number means MB, or an explicit `k`/`m`/`g` suffix. The
  ceiling is approximate upward: the file is checked between writes, so it can
  end slightly above the limit.
- `logs/` is already gitignored; empty process folders are kept with `.gitkeep`.

## Rotation implementation
Rotation is delegated to `pino-roll` via `pino.transport({ target: 'pino-roll' })`
with `frequency: 'daily'`, `dateFormat: 'yyyyMMdd'`, `size` and `mkdir: true`.

An earlier attempt concluded that pino-roll could not roll by size and replaced it
with a local `DailyRotatingStream`. That conclusion was wrong and was caused by a
badly configured test: the size value was passed without a unit, and pino-roll
interprets a bare number as **MB** (not bytes), so a small probe payload could
never reach the ceiling. The documented `filename.date.count.extension` naming is
also exactly what was required. `DailyRotatingStream` was removed.

`pino-http` was installed as the planned request logger but dropped: the custom
`HttpLoggingInterceptor` already covers method, route, status, duration and
`reqId` without logging bodies, so a second HTTP logging path would be a parallel
system for the same job. Logging dependencies: `pino`, `pino-roll` and
`pino-pretty` (dev).

Retention (120 days) is handled by the local `purgeExpired()` in the service, not
by pino-roll: `limit` in pino-roll prunes by file count, not by age. A dedicated
purge module is planned as a follow-up.

## Record format
JSON Lines, one JSON object per line, `.log` extension, `.jsonl` content internally:

```json
{"level":"info","time":"2026-09-13T18:45:23.104Z","reqId":"req-a3f9","context":"NotesService","msg":"nota creada","noteId":"n_88x2"}
```

- `level`, `time`, `msg`: pino base fields.
- `context`: the Nest logger context (`NotesService`, `RatesService`, ...).
- `reqId`: `req-` + short id, present when the record happens inside an HTTP request.
- Extra domain fields (ids, counts, durations) added as flat keys.

## Levels
- Active level comes from `LOG_LEVEL` in the backend `.env` (default `info`).
- Normal runtime: `info`. Debugging a specific problem: `LOG_LEVEL=debug`.
- Console: `pino-pretty` in dev, raw JSON Lines in production.

## Redaction (HARD RULE)
Redaction is explicit, not automatic. pino only redacts what the config lists.

Never log, in any record and at any level:
- `password`, `passphrase`, `masterKey`, `pepper`, `secret`, `token`, `apiKey`.
- Headers `authorization` and `cookie`.
- Full request bodies for auth, vault, apikeys and boveda routes.

Enforcement, in order:
1. The HTTP logger does not log request bodies at all (only method, route, status,
   duration, reqId). This removes the risk at the source.
2. `redact` in the logger config as a second layer, with `remove: true` for the paths
   above, so any future body logging stays safe.
3. Business logs pass identifiers and metadata, never secrets.

## Retention
- Automatic purge at boot of log files whose date is older than 120 days.

## Acceptance criteria
1. `tsc` and `build` clean for backend; CI runs typecheck and build.
2. Boot writes `logs/backend/backend_YYYYMMDD.log` with valid JSON Lines
   (`level`/`time`/`context`/`msg`).
3. A request produces an HTTP record with a `reqId`, and business logs emitted while
   handling it carry the same `reqId`.
4. `POST /auth/login` with a passphrase does not write the passphrase anywhere in the
   log files.
5. Rotation: with the size ceiling lowered for the test, a second file `_r002` appears.
6. Purge: a log file dated beyond the retention window is removed at boot.

## Verification
Every criterion was exercised against the compiled `LoggerService` in isolation
(no infrastructure needed):

1. `tsc` and `build` clean for backend.
2. Boot wrote `logs/backend/backend.20260913.1.log` with valid JSON Lines and
   `level` as a label (`"info"`, not `30`).
3. A record inside `runWithRequestContext` inherited `reqId` from the request;
   the HTTP record carried the same id.
4. A log call carrying `password` and `passphrase` produced a line with **neither
   field** present (pino `remove: true`).
5. With `LOG_MAX_FILE_SIZE=1k`, records split into `backend.20260913.1.log` and
   `backend.20260913.2.log`; `errors.*` held only the warn/error records. The
   ceiling is approximate upward (pino-roll checks between writes).
6. A file dated `20200101` was deleted at boot while a future-dated one stayed.

Defects found and fixed during verification:
- The log directory default resolved from `process.cwd()`, so launching from the
  repo root could write outside the repo. It now resolves from the repo root
  marker.
- The error mirror emitted duplicate `msg` keys in one JSON object.
- pino-roll was first discarded on a falsely configured size test and replaced by
  a local stream; after the unit fix it handles rotation and naming, so the local
  stream was removed.
