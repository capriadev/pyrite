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
- feature/logs-purge: spec 023 completa y verificada (19 aserciones puras, 23 chequeos HTTP); PR pendiente de abrir.
- refactor/disputes-split: spec 022 verificada (disputes.service de 775 a 159 lineas); PR #28 abierta esperando merge.
- Frente de disputas backend mergeado: specs 019, 020 y 021 (PRs #24, #25, #27) mas el test recuperado (#26).
- Verificacion del backend: `apps/backend/test/` (34 + 22 + 31 + 19 aserciones y 8 humos HTTP; README adentro).

## Next up
- Abrir la PR del purge y mergear la #28.
- #23 recordatorio de rotacion de credenciales (pendiente chico, backend).
- Visor de logs para el front (lectura: listar, filtrar, tail): registrar como feature cuando el indice no este compartido entre ramas.
- UI (#24): el usuario avisa cuando arranca el front.

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
