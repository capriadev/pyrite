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
- feature/calendar-core: backend de la spec 015 commiteado (a198532) y pusheado; tsc, build y 21 aserciones del motor en verde. Faltan humo HTTP y UI.
- PRs #18 (memoria) y #19 (refactor de counts) sin mergear; la rama de calendar stackea sobre #19.
- pyrite_test: migrada y sembrada; scripts de prueba en temp/live/*.mjs; instancia de prueba en 30101.

## Next up
- Spec 015: humo HTTP de /tasks y /calendar contra la base (requiere levantar el backend, pedido explicito del usuario).
- Notes UI (features.md #17).
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
