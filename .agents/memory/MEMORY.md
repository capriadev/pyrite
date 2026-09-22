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
- Frente de disputas backend cerrado y mergeado: specs 019 (PR #24) y 020 (PR #25) en main, mas el test recuperado (PR #26).
- Arranca la spec 021: intake desde finances con payload preconfigurado y grupo de sistema finances/ (rama feature/disputes-intake).
- Verificacion del backend: `apps/backend/test/` (34 aserciones del motor, 22 del matcher, 31 del scorer, 6 humos HTTP; README adentro).

## Next up
- Spec 021 en curso (intake + grupo finances/).
- Spec de refactor: separar las resoluciones y los settings de disputes.service (776 lineas; registrado en docs/records/020).
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
- Arbol duplicado D:\1__Programacion\1__programacion\ creado por error del editor: borrar (requiere confirmacion dos veces).
