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
- feature/tasks-organization: spec 016 completa y verificada (arbol de grupos, sector, prioridad, estado, descripcion y vinculo a expectativa); 17 chequeos HTTP nuevos y sin regresion de la 015. Sin PR abierta.
- Spec 015 (calendario backend) verificada y mergeada en main (PR #20): 21 aserciones del motor y 18 chequeos HTTP.
- Pendientes del frente: 017 fechas y horarios (#25), 018 pagos v2 (#26), UI (#24), notificaciones (#27).
- pyrite_test: migrada y sembrada; scripts de prueba en temp/live/*.mjs; instancia de prueba en 30101.

## Next up
- Abrir la PR de feature/tasks-organization y encarar la 017 (puntual simple/rango/multiple, semanal con dias y horario por dia, switch 28/02 o 01/03).
- Notes UI (features.md #17).
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
