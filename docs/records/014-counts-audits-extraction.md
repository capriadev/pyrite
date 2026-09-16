# Registro: separacion de las auditorias de counts (spec 014)

- Spec: `.agents/memory/specs/014-counts-audits-extraction.md`
- PR: #19 (rama `refactor/counts-audits`)
- Fecha: 2026-09-15
- Entorno: repositorio local, sin instancia levantada (verificacion estatica).

## Que se construyo

- `counts-view.ts` contiene `CountsAccountView`, `toView` y `toViews(repo, rows)`; `toViews` recibe el repositorio como argumento para que el modulo quede sin DI.
- `counts-audits.service.ts` es dueño de `weakAudit`, `duplicatesAudit`, `CountsDuplicateGroup`, la clave `counts.weak_threshold`, el default (50), el helper de umbral, su propio `requireUnlocked` y su logger. La derivacion por registro pasa por `SectionKeysService.recordKey`, la misma llamada que usa el camino CRUD.
- `counts.service.ts`: de 578 a 453 lineas; la seccion AUDITS, el helper de umbral, las constantes, `SettingsService` y ambos mappers de vista desaparecen, y todo lo demas (CRUD, reveal, history, groups, rotador de 013) queda intacto.
- `counts.controller.ts` inyecta `CountsAuditsService`; rutas y formas de respuesta sin cambios. `bll.module.ts` registra y exporta el nuevo provider.
- Sin desviaciones respecto al approach; ningun cambio de comportamiento mas alla del reparto de archivos.

## Que se verifico

- `npx tsc --noEmit` y `npm run build` limpios (`noUnusedLocals` esta activo, asi que no quedo ningun import huerfano). Sin smoke en vivo: levantar la instancia de test quedaba fuera de alcance.
