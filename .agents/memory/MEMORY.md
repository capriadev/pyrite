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
- feature/disputes-core: spec 019 completa y verificada (22 aserciones del matcher, 38 chequeos HTTP); PR pendiente de abrir.
- Specs 020 y 021 escritas como borradores sin commitear en specs/ (se commitean al iniciar cada una).
- Verificacion del backend: `apps/backend/test/` (34 aserciones del motor, 22 del matcher, 5 humos HTTP; README adentro).

## Next up
- Abrir la PR de feature/disputes-core y mergearla.
- Spec 020 (scoring probabilistico) y despues 021 (intake desde finances + grupo finances/).
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
- Arbol duplicado D:\1__Programacion\1__programacion\ creado por error del editor: borrar (requiere confirmacion).
