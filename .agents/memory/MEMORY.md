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
- feature/tasks-dates: spec 017 completa y verificada (puntual simple/rango/multiple, semanal con dias y hora por dia, bisemanal anclada, switch 28/02 o 01/03); PR pendiente de abrir.
- feature/tasks-organization: spec 016 completa y verificada; PR #21 esperando merge.
- Pendientes del frente: 018 pagos v2 (#26), UI (#24), notificaciones (#27).
- pyrite_test: migrada y sembrada; scripts de prueba en temp/live/*.mjs; instancia de prueba en 30101.

## Next up
- Abrir la PR de feature/tasks-dates y encarar la 018 (prueba con unidad y cantidad).
- Notes UI (features.md #17).
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
