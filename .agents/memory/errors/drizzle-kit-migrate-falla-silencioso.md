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
- Investigar a futuro: probable incompatibilidad drizzle-kit 0.31 vs drizzle-orm 0.45 (migrate usa la tabla `__drizzle_migrations` que 0.31 crea con un formato que 0.45 no lee). Considerar alinear la version de drizzle-kit o migrar el flujo.

## Tags
<drizzle> <orm> <migrate> <windows>