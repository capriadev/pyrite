# Memory - Pyrite (working state only)

Update at session close. This is not a changelog: it is the state of the work.

<!-- Rules (agent-facing):
- Working state only: in flight, next, blocked, open decisions, and norms with no other owner.
- One line per item, no prose, no connectives, no history. If it is readable in git log, a PR, a spec or another bank, it does not go here.
- Norm (true next week regardless of the work) belongs to AGENTS.md or architecture.md; state (changes as work advances) belongs here.
- Caps: State <= 5, Next up <= 5, Open decisions <= 3. Overflow means wrong bank: move it, do not trim it.
- Session close: delete resolved, move escalated. Never duplicate another bank.
-->

## State (in flight)
- feature/tasks-payments-v2: spec 018 completa y verificada (prueba con unidad y cantidad); PR pendiente de abrir.
- Frente Tasks backend cerrado: 015 + 016 + 017 + 018 mergeadas o en PR; quedan la UI (#24) y las notificaciones (#27).
- Pendientes posteriores: motores de proyeccion y de conciliacion (specs nuevas, sin abrir).
- pyrite_test: migrada y sembrada; scripts de prueba en temp/live/*.mjs; instancia de prueba en 30101.

## Next up
- Abrir la PR de feature/tasks-payments-v2.
- Notes UI (features.md #17) o abrir el frente de los motores de proyeccion y conciliacion.
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
