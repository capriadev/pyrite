# drizzle-enum-y-constraint-drift - snapshot reconstruido a mano genera drift falso

## Summary
Reconstruir un snapshot de `drizzle-kit` a mano introduce nombres de constraint/index incorrectos, y el siguiente `generate` produce SQL destructivo sobre tablas que no cambiaron (drop y recreate de FKs, drop de unique) o directamente `data is malformed`.

## Context
- Aparece cuando falta un `meta/NNNN_snapshot.json` (p. ej. una migracion aplicada a mano) y se reconstruye el snapshot escribiendolo a mano en vez de dejar que drizzle-kit lo derive.
- Sintomas:
  - `drizzle-kit generate` falla con `drizzle\migrations\meta\0005_snapshot.json data is malformed` (mensaje de zod, sin detalle).
  - Con el snapshot "valido", el SQL generado incluye `ALTER TABLE ... DROP CONSTRAINT`, `DROP INDEX` y `CREATE INDEX` sobre tablas no modificadas.
  - El schema declaraba una FK/PK/unique que **no aparecia** en el snapshot derivado (`foreignKeys: {}`, `compositePrimaryKeys: {}`, `uniqueConstraints: {}`).

## Solution
1. **No inventar el snapshot.** Generar la migracion que falta y usar su `meta/NNNN_snapshot.json` como base (es el estado que drizzle-kit deriva del schema). Luego reescribir solo lo minimo.
2. Para diagnosticar `data is malformed` (zod no da el detalle), parsear con el validador interno de drizzle-kit. `bin.cjs` define `pgSchema` dentro de `init_pgSchema()`; cargarlo en un `vm` y llamarlo da el `ZodError` real:
   ```js
   const vm = require('vm');
   const ctx = vm.createContext({ require, module: { exports: {} }, exports: {}, __dirname, __filename, console });
   vm.runInContext(require('fs').readFileSync('node_modules/drizzle-kit/bin.cjs', 'utf8'), ctx);
   ctx.init_pgSchema();
   const res = ctx.pgSchema.safeParse(JSON.parse(require('fs').readFileSync('.../0005_snapshot.json', 'utf8')));
   console.log(res.success ? 'OK' : res.error.issues);
   ```
3. Formato v7 de los campos que suelen salir mal:
   - `indexes` (v7): `columns` es un array de **objetos** `{ expression, isExpression, asc, nulls }`, no de strings.
   - Nombre de FK derivado por drizzle para `.references()`: `<tabla>_<col>_<tablaRef>_<colRef>_fk` (**`_fk`**, no `_fkey`).
   - `unique()` (constraint) va en `uniqueConstraints`; `uniqueIndex()` (indice) va en `indexes`. No son intercambiables.
4. Verificar el resultado con `drizzle-kit generate`: debe imprimir `No schema changes, nothing to migrate`.

## Pitfalls
- **La API de constraints en `schema.ts` cambio.** drizzle-orm 0.4x+ usa un callback que devuelve un **array** de builders (`(t) => [primaryKey({...}), unique('...').on(...), foreignKey({...}).onDelete(...)]`), no un objeto con shape propio. Con el formato viejo, drizzle-kit **no detecta** el constraint y el snapshot lo omite en silencio.
- **Un snapshot con `id`/`prevId` no-ASCII/UUID invalido** pasa como string pero rompe la cadena; el `prevId` del snapshot siguiente debe matchear el `id` anterior. Comprobar la cadena antes de commitear.
- El SQL destructivo generado por drift **no se puede aplicar a ciegas**: revisar cada `DROP` antes de correr `orm:migrate`, porque toca tablas que no fueron parte del cambio.
- `drizzle-kit generate` renumera segun el `_journal.json`; si sobra una entrada fantasma, la nueva migracion sale con un numero mas alto y hay que limpiar journal + archivos a la vez.

## Tags
<drizzle> <orm> <snapshot> <schema> <drift> <windows>