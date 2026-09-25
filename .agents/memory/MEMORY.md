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
- refactor/domain-decoupling: spec 025 completa y verificada (10 chequeos HTTP, saldo atomico probado contra el defecto viejo); PR pendiente de abrir.
- Mergeado en main: specs 022, 023 y 024 (PRs #30 y #31) mas el frente de disputas (019, 020, 021).
- Verificacion del backend: `apps/backend/test/` (34 + 22 + 31 + 19 + 44 aserciones y 10 humos HTTP; README adentro).
- Modulos puros copiables a otro proyecto (auditados en la 025): motores de recurrencia, matcher, scorer, retencion y lectura de logs, guards, types/dates, crypto, integrations.

## Next up
- Mergear la PR #35 (desacoplamiento + saldo atomico) y despues la de multi-moneda, en ese orden.
- #37 Rates pair and base currency: segunda mitad del frente multi-moneda (spec 027).
- #34 Finances multi-entrada, #23 recordatorio de rotacion, #27 notificaciones.
- UI (#24): el usuario avisa cuando arranca el front.

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
