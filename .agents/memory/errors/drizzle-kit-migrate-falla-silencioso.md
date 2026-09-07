# drizzle-kit migrate falla silencioso (applying migrations + exit 1)

## Summary
`drizzle-kit migrate` (0.31.10) con drizzle-orm 0.45 imprime "applying migrations..." y sale con exit 1 sin aplicar nada, sin mensaje de error.

## Context
- Apare al correr `npm run orm:migrate` o `orm:migrate:test` contra el config `drizzle.config.ts` (dialect postgresql, dbCredentials host/port).
- `generate` funciona bien (genera el `.sql`). `pg` directo conecta bien a la DB. Solo `migrate` falla.
- Probado con `DB_NAME` via cross-env, `DATABASE_URL`, y config directo - todos fallan igual.

## Solution

- Aplicar la migración generada manualmente vía psql (el `.sql` ya fue revisado por el flolo):
  ```bash
  Get-Content drizzle/migrations/0000_*.sql -Raw | docker exec -i pyrite-postgres psql -U pyrite -d pyrite
  ```
- (PowerShell no soporta `<` de redir de entrada; usar `Get-Content -Raw | docker exec -i`.)

## Root cause (confirmed 2026-09-07)
- `drizzle-kit migrate` swallows the error: `renderWithTask`'s catch does `process.exit(1)` WITHOUT printing the error. The "applying migrations..." spinner looks identical in pending vs rejected state, so failure is indistinguishable from success except the exit code (and `%ERRORLEVEL%` in cmd is evaluated before the command, so exit 0 was an artifact - also unreliable as a signal).
- Trigger of the original silent failure: migration 0000 had been applied manually via psql, so `CREATE TABLE settings` failed with "already exists" on a real `migrate`, which the CLI swallowed.
- Recurring caveat: drizzle-kit 0.31's `migrate` is essentially a no-op unless `drizzle.config.ts` resolves a valid connection; it neither applies nor creates the tracking table. Workflow relies on review-the-.sql + apply-via-psql.

## Tags
<drizzle> <orm> <migrate> <windows>