# drizzle-migraciones-sin-baseline - DB con tablas pero sin drizzle.__drizzle_migrations (falso diagnostico)

## Summary
Una DB de Pyrite puede tener las tablas creadas y **no** tener `drizzle.__drizzle_migrations`, en cuyo caso `orm:migrate` intenta aplicar desde `0000` y choca con las tablas existentes. Verificar SIEMPRE si la tabla de seguimiento existe antes de concluir que falta: el sintoma tambien aparece cuando la tabla existe pero la consulta de comprobacion falla (ver Pitfalls).

## Context
- Caso real verificado (`pyrite_test`): 9 tablas creadas por `push`, `drizzle.__drizzle_migrations` existe **vacia** (0 filas). `orm:migrate:test` hace `CREATE TABLE "api_keys" ... already exists` y sale con exit 1.
- Caso real verificado (`pyrite`): la tabla **si existia** con las 7 filas (0000-0006) y `applied_at` correlacionado con el `when` del journal. El flujo `migrate` se uso desde el principio; el "no hay migraciones" fue un falso negativo causado por una consulta mal formada (ver Pitfalls).
- Sintoma tipico: `drizzle-kit migrate` imprime `applying migrations...` y termina con exit 1, sin mensaje util.

## Solution
Baseline: marcar las migraciones ya aplicadas como tales sin re-ejecutar su SQL.

1. **Comprobar primero si la tabla de seguimiento existe y que contiene.** No asumir:
   ```bash
   docker exec pyrite-postgres psql -U pyrite -d pyrite \
     -c 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;'
   ```
2. Si no existe, recrearla (mismo DDL que usa drizzle-orm):
   ```sql
   CREATE SCHEMA IF NOT EXISTS drizzle;
   CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
     id SERIAL PRIMARY KEY,
     hash text NOT NULL,
     created_at bigint
   );
   ```
3. Calcular el hash real de cada `.sql` ya aplicado. Es `sha256` del contenido crudo leido con `readFileSync().toString()`. Lo mas fiable es usar el propio drizzle-orm, que devuelve hash y `folderMillis` ya calculados:
   ```bash
   node -e "const {readMigrationFiles}=require('drizzle-orm/migrator');readMigrationFiles({migrationsFolder:'./apps/backend/drizzle/migrations'}).forEach(m=>console.log(m.hash,m.folderMillis));"
   ```
4. Insertar una fila por migracion aplicada, con `(hash, created_at)`. El `created_at` debe ser el `when` del journal de esa migracion (drizzle compara `Number(lastDbMigration.created_at) < migration.folderMillis` y solo considera la fila con `created_at` maximo).
5. Verificar que la DB real coincide con el ultimo snapshot: `drizzle-kit generate` debe reportar `No schema changes, nothing to migrate`.

## Pitfalls
- **`psql -c` con comillas simples se rompe en PowerShell.** Una consulta como `-c 'SELECT ... FROM drizzle.__drizzle_migrations'` pasa mal las comillas y devuelve `relation does not exist`, que se lee facilmente como "la tabla no existe" cuando en realidad la consulta nunca llego bien. **La tabla si existia.** Comprobar con `information_schema.tables` o usar comillas dobles escapadas antes de concluir un falso negativo.
- **La variable de entorno persiste en la sesion de PowerShell.** Un `$env:DB_NAME='pyrite_test'` de un comando anterior queda activo y hace que `migrate` corra contra otra DB sin avisar. Siempre `Remove-Item Env:\DB_NAME` antes de operar sobre `pyrite`.
- **`drizzle-kit migrate` traga el error real.** Para ver la causa, usar el migrator de drizzle-orm (`drizzle-orm/node-postgres/migrator`) o correr el SQL a mano.
- **`drizzle-kit` re-agrega entradas al `_journal.json` desde su estado interno aunque se borre el `.sql`**, y renumera en el proximo `generate`. Limpiar journal y archivos a la vez, o el proximo generate sale con otro numero.
- **`push` no escribe `drizzle.__drizzle_migrations`.** Si una DB se creo con `push`, hace falta el baseline antes de volver a `migrate`.

## Tags
<drizzle> <orm> <migrate> <baseline> <windows> <postgres>
