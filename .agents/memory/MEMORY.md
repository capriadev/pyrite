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
- feature/calendar-core: spec 015 completa y verificada (tsc, build, 21 aserciones del motor y 18 chequeos HTTP contra pyrite_test); commits f4ae023..5f6d376, pusheada, sin PR abierta.
- Pendiente del frente: UI de calendario y tasks (features.md #24) y la capa de organizacion de tasks (#19).
- PRs #18 (memoria) y #19 (refactor de counts) sin mergear; la rama de calendar stackea sobre #19.
- pyrite_test: migrada y sembrada; scripts de prueba en temp/live/*.mjs; instancia de prueba en 30101.

## Next up
- Abrir la PR de feature/calendar-core (stackea sobre #19, que stackea sobre #18).
- Notes UI (features.md #17).
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
