# Memory - Pyrite (dynamic, session-to-session)

Update at end of session / significant checkpoint. Prune what's stale - this is not a changelog, it's working state.

<!-- Pruning rules (respected each session):
- No section should grow unbounded. If "Watch" has > ~5 lines, something should have been promoted to `errors/` or to a spec.
- Never copy content from `architecture.md`, `AGENTS.md` or `PHILOSOPHY.md` - MEMORY.md doesn't duplicate sources of truth, only references by filename/spec.
- At session close: review if anything in "Next up" got resolved (delete) or if anything in "Watch" escalated to a documented error (move, don't copy).
-->

## Last session
- 2026-09-12: Spec #12 (Notes backend) implementada y verificada end-to-end. PR #13 (feat/notes -> main), pendiente de merge. Reorg de capas por dominio (spec #10) y fix drizzle (spec #11) ya en main/rama. Migracion 0005_notes_and_unified_groups aplicada en test y prod. Smoke confirmo: CRUD cifrado, modo privado con lock real (fix de fuga de contenido cerrado), busqueda, groups unificados por dominio, soft-delete, y 409 en grupo duplicado.

## Next up
- Mergear PR #13 (feat/notes). Al mergear: cerrar spec #12 (quitar linea de features.md, marcar spec completed).
- Notes UI (frontend): pendiente. Ideas anotadas: carpetas, markdown avanzado + math, preview en crear/editar, orden reciente con carpetas/pin arriba, busqueda titulo/contenido, filtros (todos/destacado/grupo/fecha), modal de passphrase para privadas. Correr react-doctor tras cambios de UI.
- Counts backend -> luego Calendar -> Tasks -> unificar Calendar+ambos -> motor de errores de finanzas con Calendar y Task.
- Finances UI (spec #9) al iniciarse dispara la sub-spec C (graficos/filtros, spec 005).

## Open decisions (unresolved, blocking or not)
- (ninguna bloqueante)

## Watch / don't forget
- Never use emojis or em dashes (—) in anything written for the project (docs, READMEs, commits, UI copy). Plain ASCII punctuation only.
- Host port de Postgres es 5433: otros proyectos locales (organizador-db) ocupan el 5432 del host. No volver a mapear 5432.
- El volumen postgres-data se inicializó con credenciales distintas a las del compose actual (password reseteado a mano a pyrite/pyrite). Si se borra el volumen, el compose lo inicializa bien.
- NO levantar servicios ni infraestructura (docker, dev servers) sin pedido explícito del usuario.
- drizzle vive en apps/backend/drizzle (schema.ts + migrations) con apps/backend/drizzle.config.ts y scripts orm con `cd apps/backend`. El build backend usa rootDir "." y emite a dist/src/main.js (sin prefijo apps/backend). Los scripts orm raíz hacen `cd apps/backend && drizzle-kit <cmd>` (el config usa paths relativos al cwd).
- Runtime decidido: Node 24.20.0 gestionado con nvm (.nvmrc en raíz, engines >=24.20 <25). Cambiar de major solo con decisión explícita del usuario. Migración 22->24 completada y verificada (tsc/build/health OK, cero cambios de código: la guía oficial nodejs.org/en/blog/migrations/v22-to-v24 no afecta a nuestro stack). Nota a futuro: OpenSSL 3.5 security level 2 en Node 24 prohibe claves RSA/DSA/DH < 2048 bits - tenerlo en cuenta en el spec de seguridad/auth.
- SPECS NUNCA SE BORRAN: specs/ es registro permanente; al completar una feature se quita su línea de features.md y se marca la spec como completed. Numeración secuencial para eso.
- react-doctor en frontend (script `npm run doctor`): scanner local de calidad React, telemetría siempre off (`--no-telemetry`), NO es gate de CI (envía telemetría/interactúa con Chrome vía playwright-core). Config en doctor.config.ts (alcance src/). Correr tras cambios de UI; la skill del agente la instala/adapta el usuario bajo `.agents/skills/`.
- skills-lock.json: el computedHash de react-doctor quedó desactualizado a propósito tras personalizar la skill a mano (quitar references/, local-only, telemetry-off). El lock es snapshot de instalación; no regenerarlo reinstalando (perdería la personalización).