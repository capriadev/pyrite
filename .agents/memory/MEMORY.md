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
- refactor/counts-audits: PR #19 abierta (stackeada sobre #18); tsc y build limpios, sin mergear.
- Counts cerrado (specs 012, 013, 014). Siguiente frente: Calendar (features.md #18).
- pyrite_test: migrada y sembrada; scripts de prueba en temp/live/*.mjs; instancia de prueba en 30101.

## Next up
- Notes UI (features.md #17).
- Frontend: traducir el 409 de escritura durante una rotacion a un aviso con reintento (spec 013).

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
