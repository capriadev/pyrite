# Memory - Pyrite (dynamic, session-to-session)

Update at end of session / significant checkpoint. Prune what's stale - this is not a changelog, it's working state.

<!-- Pruning rules (respected each session):
- No section should grow unbounded. If "Watch" has > ~5 lines, something should have been promoted to `errors/` or to a spec.
- Never copy content from `architecture.md`, `AGENTS.md` or `PHILOSOPHY.md` - MEMORY.md doesn't duplicate sources of truth, only references by filename/spec.
- At session close: review if anything in "Next up" got resolved (delete) or if anything in "Watch" escalated to a documented error (move, don't copy).
-->

## Last session
- 2026-08-29: <one line, what actually happened>

## Next up
- <concrete next action, tied to a spec ID if applicable>

## Open decisions (unresolved, blocking or not)
- <question> - <options being weighed, if any>

## Watch / don't forget
- <thing that will bite you if forgotten - not a full errors/ post-mortem, just a flag>