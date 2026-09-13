# Memory - Pyrite (dynamic, session-to-session)

Update at end of session / significant checkpoint. Prune what's stale - this is not a changelog, it's working state.

<!-- Pruning rules (respected each session):
- No section should grow unbounded. If "Watch" has > ~5 lines, something should have been promoted to `errors/` or to a spec.
- Never copy content from `architecture.md`, `AGENTS.md` or `PHILOSOPHY.md` - MEMORY.md doesn't duplicate sources of truth, only references by filename/spec.
- At session close: review if anything in "Next up" got resolved (delete) or if anything in "Watch" escalated to a documented error (move, don't copy).
-->

## Last session
- 2026-09-13: Sesion de docs (rama docs/refresh): MEMORY al dia (logging mergeado, puerto corregido a 30010), architecture con la fila de Logging y la distincion config app/usuario (DB) vs config backend/infra (.env), capa types/, layout con logs/ y .github/; feature #6 (APIs) marcada completed y sacada del indice. Sin cambios en specs/ (registro permanente).

## Next up
- Notes UI (frontend): carpetas, markdown avanzado + math, preview en crear/editar, orden reciente con carpetas/pin arriba, busqueda titulo/contenido, filtros (todos/destacado/grupo/fecha), modal de passphrase para privadas. Correr react-doctor tras cambios de UI.
- Counts backend -> luego Calendar -> Tasks -> unificar Calendar+ambos -> motor de errores de finanzas con Calendar y Task.
- Finances UI (spec #9) al iniciarse dispara la sub-spec C (graficos/filtros, spec 005).
- Purge dedicado de logs (hoy la retencion por dias la hace purgeExpired() en logger.service.ts al arrancar).
- Poda de ramas locales/remotas ya mergeadas; destructivo, requiere confirmacion explicita del usuario.

## Open decisions (unresolved, blocking or not)
- `satellite-services/` esta untracked: definir si el codigo vendoreado se commitea o va a .gitignore (local-only). No bloquea.

## Watch / don't forget
- Never use emojis or em dashes (—) in anything written for the project (docs, READMEs, commits, UI copy). Plain ASCII punctuation only.
- Host port de Postgres es 30010 (mapeo 30010:5432 en docker-compose; DB_PORT=30010 en .env.example). Otros proyectos locales ocupan el 5432 del host, por eso el mapeo no es 5432.
- El volumen postgres-data se inicializó con credenciales distintas a las del compose actual (password reseteado a mano a pyrite/pyrite). Si se borra el volumen, el compose lo inicializa bien.
- NO levantar servicios ni infraestructura (docker, dev servers) sin pedido explícito del usuario.
- drizzle vive en apps/backend/drizzle (schema.ts + migrations) con apps/backend/drizzle.config.ts y scripts orm con `cd apps/backend`. El build backend usa rootDir "." y emite a dist/src/main.js (sin prefijo apps/backend). Los scripts orm raíz hacen `cd apps/backend && drizzle-kit <cmd>` (el config usa paths relativos al cwd).
- Runtime decidido: Node 24.20.0 gestionado con nvm (.nvmrc en raíz, engines >=24.20 <25). Cambiar de major solo con decisión explícita del usuario. Migración 22->24 completada y verificada (tsc/build/health OK, cero cambios de código: la guía oficial nodejs.org/en/blog/migrations/v22-to-v24 no afecta a nuestro stack). Nota a futuro: OpenSSL 3.5 security level 2 en Node 24 prohibe claves RSA/DSA/DH < 2048 bits - tenerlo en cuenta en el spec de seguridad/auth.
- SPECS NUNCA SE BORRAN: specs/ es registro permanente; al completar una feature se quita su línea de features.md y se marca la spec como completed. Numeración secuencial para eso.
- Logs: rotacion delegada a pino-roll (`pino.transport({target:'pino-roll'})`, frequency daily + dateFormat yyyyMMdd + size, mkdir). CLAVE: en pino-roll un `size` SIN unidad se interpreta como MB, no bytes (unidades validas k/m/g); `limit` exige `limit.count` o tira al arrancar; la invocacion correcta es via transport, no `pino(roll(...))`. Retencion por dias (120) la hace purgeExpired() propio en logger.service.ts, NO pino-roll (que poda por cantidad); hay un purge dedicado planificado como follow-up. El dir de logs se resuelve desde la raiz del repo (marker workspaces), nunca desde cwd. Requisito duro: bodies de request NO se loguean y la redaccion (REDACT_PATHS) cubre password/passphrase/masterKey/pepper/secret/token/apiKey y headers authorization/cookie. Nivel por LOG_LEVEL (info por defecto).
- react-doctor en frontend (script `npm run doctor`): scanner local de calidad React, telemetría siempre off (`--no-telemetry`), NO es gate de CI (envía telemetría/interactúa con Chrome vía playwright-core). Config en doctor.config.ts (alcance src/). Correr tras cambios de UI; la skill del agente la instala/adapta el usuario bajo `.agents/skills/`.
- skills-lock.json: el computedHash de react-doctor quedó desactualizado a propósito tras personalizar la skill a mano (quitar references/, local-only, telemetry-off). El lock es snapshot de instalación; no regenerarlo reinstalando (perdería la personalización).