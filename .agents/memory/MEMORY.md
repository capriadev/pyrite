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
- refactor/disputes-split: spec 022 completa y verificada (disputes.service de 775 a 159 lineas; bateria entera en verde); PR pendiente de abrir.
- Frente de disputas backend cerrado y mergeado: specs 019, 020 y 021 (PRs #24, #25, #27) mas el test recuperado (#26).
- Verificacion del backend: `apps/backend/test/` (34 aserciones del motor, 22 del matcher, 31 del scorer, 7 humos HTTP; README adentro).

## Next up
- Abrir y mergear la PR del refactor (spec 022).
- UI (#24): calendario, tasks y panel del motor (el usuario avisa cuando arranca el front).
- Motor de proyecciones (pendiente del roadmap; desbloquea el desvio del plan que quedo como v2 del motor).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
- Arbol duplicado D:\1__Programacion\1__programacion\ creado por error del editor: borrar (requiere confirmacion dos veces).
