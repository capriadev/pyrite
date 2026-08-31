# Memory - Pyrite (dynamic, session-to-session)

Update at end of session / significant checkpoint. Prune what's stale - this is not a changelog, it's working state.

<!-- Pruning rules (respected each session):
- No section should grow unbounded. If "Watch" has > ~5 lines, something should have been promoted to `errors/` or to a spec.
- Never copy content from `architecture.md`, `AGENTS.md` or `PHILOSOPHY.md` - MEMORY.md doesn't duplicate sources of truth, only references by filename/spec.
- At session close: review if anything in "Next up" got resolved (delete) or if anything in "Watch" escalated to a documented error (move, don't copy).
-->

## Last session
- 2026-08-31: Fase 0 completa (commit base, READMEs ES/EN). Spec #1 backend skeleton activo en rama feature/backend-skeleton: Nest + Drizzle + Redis + /health, probado en vivo (200 OK).

## Next up
- Spec #2: esqueleto frontend (Next.js) - pendiente de abrir.
- Validar el esqueleto backend y ajustar; al cerrar, merge a main y borrar rama.

## Open decisions (unresolved, blocking or not)
- (ninguna bloqueante)

## Watch / don't forget
- Never use emojis or em dashes (—) in anything written for the project (docs, READMEs, commits, UI copy). Plain ASCII punctuation only.
- Host port de Postgres es 5433: otros proyectos locales (organizador-db) ocupan el 5432 del host. No volver a mapear 5432.
- El volumen postgres-data se inicializó con credenciales distintas a las del compose actual (password reseteado a mano a pyrite/pyrite). Si se borra el volumen, el compose lo inicializa bien.
- NO levantar servicios ni infraestructura (docker, dev servers) sin pedido explícito del usuario.
- drizzle vive en la raíz del repo (/drizzle/schema.ts + /drizzle/migrations + drizzle.config.ts en raíz), no dentro de apps/backend. El build del backend usa rootDir "../.." y emite a dist/apps/backend/src/main.js.
- Runtime decidido: Node 24.20.0 gestionado con nvm (.nvmrc en raíz, engines >=24.20 <25). Cambiar de major solo con decisión explícita del usuario.