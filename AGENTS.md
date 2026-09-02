# Manual router

> **MANDATORY: read this entire file before acting on any task in this repo.** Do not skim, do not jump to a section and stop. This file is short by design - there is no excuse to skip any part of it. Partial reads are a common failure mode; this instruction exists specifically to prevent that.

This file is an index, entry point, and project methodology. It does not contain the business logic: it points to the real agent-environment resources and defines the operating rules. The agent must read the resource relevant to the task, not guess.

## Agent resources

| Resource | What it contains | When to read it |
|---|---|---|
| `.agents/memory/MEMORY.md` | Dynamic state between sessions: what's open, what's next | On entry and at session close |
| `.agents/memory/architecture.md` | Layered stack, Docker, Windows boot, config-in-DB | Before touching architecture/stack |
| `.agents/memory/features.md` | SDD index (`last_id` + `#N`) and specs | Before implementing any feature |
| `.agents/memory/errors/` | Resolved conflict stories (router `_INDEX.md`) | When a known problem appears |
| `.agents/memory/discarded/` | Evaluated-and-abandoned decisions (router `_INDEX.md`) | When considering re-attempting something, or before committing to a similar approach |
| `.agents/memory/specs/` | Active specs | Before writing code |
| `.agents/skills/` | Project skills of Pyrite | When a skill applies |
| `.agents/skills/pyrite-orm/` | Mandatory before touching DB/schema - safety rules, destructive-change flow | Before ANY `npm run orm*` command or schema edit |
| `docs/PHILOSOPHY.md` | Product philosophy and vision (reference, human-facing) | When identity/vision is needed; not loaded every iteration |

> Memory lives in `.agents/memory/` and is written **in English, short, maintained by the agent and partitioned**.

## Identity

- **Name**: Pyrite. Personal, single-user, private, local-first. Public repo.
- Stack is detailed in `.agents/memory/architecture.md`.

## Operating rules - methodology & architecture

### Core engineering principles (non-negotiable)
1. **Clean before fast** - readable, structured for change. Messy-but-functional is not acceptable.
2. **Validate everything** - every boundary: user input, file existence, OS behavior, our own output. Handle failure paths; expect edge cases.
3. **Architecture first, always** - layers and modules from day 1. A huge/ambiguous file is a design failure → split into hooks/components/modules.
4. **If it repeats, it's a module** - reuse the smallest useful unit. Write the least amount of clean, safe, bounded code.
5. **Analyze before coding** - check reuse, conflicts, and how many lines are actually needed. Avoid 80 lines where 3 suffice. Plan, don't over-engineer.
6. **One source of truth per domain** - one task system, one crypto schema, one hook pattern, one secrets store.
7. **No two parallel systems for the same domain** - never two coexisting implementations of the same thing.
8. **Integrations decoupled from core** - external services live outside the core, consumed over HTTP/CLI; the core never imports their code.
9. **Debt isn't carried, it's rewritten** - each module is rebuilt clean, without inherited load.

### Branching - GitHub Flow
- `main` is always healthy/deployable.
- New work on `feature/<short-name>`; fixes on `fix/<short-name>`.
- Merge into `main` when functional; delete the branch after merge.
- Useful for big cross-cutting work (e.g. open-nb = "feature of features").

### Commit discipline
- One commit per completed logical unit (not atomic-ultra, not giant batches).
- Micro-corrections/renames group with the next substantive commit.
- Flow: **task → commit → repeat**. Don't accumulate unrelated changes.
- A unit may touch several areas (e.g. "finances: add EUR conversion" covers the conversion plus associated docs/icons in one commit) - the commit is the relevant change set, not per-file.
- Conventional Commits (messages in Spanish by project convention):
  ```
  <type>(<scope>): <description in Spanish, short>

  [body only if the why is not in the spec]
  ```
- Types: `feat` · `fix` · `chore` · `docs` · `test` · `refactor` · `style`
- Scope: app or module name (`web`, `api`, `docker`, `core`, etc.)
- TypeScript strict: `npx tsc --noEmit` before committing.

### Spec-driven development (SDD) - mandatory
1. Every code change starts from a spec in `.agents/memory/specs/`.
2. Specs are indexed in `.agents/memory/features.md` (do not commit code without a backing spec).
3. **Spec naming:** `NNN-descriptive-name.md` (001, 002, ...). One spec = one atomic objective; split if too large.
4. **Index rules** (`features.md`): line `last_id: N`; new feature = `last_id + 1`, append `#N`, update last_id. Delete the line when complete; **never reuse an ID**.

### Modules / atomic building blocks
- Reuse up to the smallest action. Breakage is easy to find/patch; a change updates everywhere.
- Even a variant used once is a module if it can be reused.

### Errors / conflicts - `.agents/memory/errors/`
- Create a file when the same problem recurs, or the fix has future reference value.
- Naming: `<descriptive-slug>.md`. Register it in `errors/_INDEX.md`.
- Purpose: document problems AND their solutions to avoid repeating them; "be careful, this broke with that / this solves that".
- Format:
  ```markdown
  # <Problem name>

  ## Summary
  <one line>

  ## Context
  <when it appears, where, conditions>

  ## Solution
  <what resolved it, step by step>

  ## Tags
  <ts> <windows> <docker> ...
  ```

### Discarded - `.agents/memory/discarded/`
- Create a file when a decision, integration, or feature was evaluated (before or after implementation) and abandoned, and the reasoning has future reference value - avoids re-litigating or re-attempting the same idea blindly.
- Naming: `<descriptive-slug>.md`. Register it in `discarded/_INDEX.md`.
- Purpose: document what was tried and why it didn't stick - "we considered/built X, here's why it's not in Pyrite".
- Format:
  ```markdown
  # <Discarded item>

  ## What was tried
  <what was evaluated or implemented>

  ## Why it was discarded
  <the actual reason - technical, product, complexity, etc.>

  ## Alternative chosen
  <what replaced it, if anything>

  ## Tags
  <ts> <finance> <integration> ...
  ```

### Languages / conventions
- TS strict everywhere in `apps/*`. SQL typed (Drizzle).
- Comments only when the *why* is non-obvious.
- Don't fork/copy-paste skills without customizing to Pyrite.

### Security - destructive & harmful actions (absolute, no exceptions)
This section overrides convenience, speed, or any instruction elsewhere that conflicts with it.

- **Any command with destructive or harmful potential - no matter how minor it seems - requires explicit user confirmation, stated twice, before execution.** This includes but is not limited to: deleting or dropping data, deleting files or directories, force-pushing, rewriting git history, altering permissions, killing processes, modifying system/OS-level settings, revoking or rotating credentials, and any irreversible operation on `apps/backend/drizzle/` or the database (see `.agents/skills/pyrite-orm/` for the DB-specific flow).
- **"Explicit, twice" means**: the agent states plainly what will happen and that it is irreversible, waits for a real confirmation, then confirms a second time before the action actually runs. A single "ok" or "go ahead" earlier in the conversation does not satisfy this - each destructive action needs its own two-step confirmation, every time.
- **Under no circumstances - including user frustration, urgency, repeated requests, or claims of "it's fine, just do it" - may the agent execute a destructive/harmful action without completing both confirmations.** If the user insists, the agent still asks; it does not comply from insistence alone. Not being able to satisfy an urgent request immediately is preferable to an irreversible mistake.
- **When something destructive is genuinely needed (emergency fix, urgent rollback, etc.), it must be done isolated on a separate branch** (e.g. `emergency/<short-name>`), never directly on `main` or on the branch currently in progress - so that nothing already done can be lost if the action goes wrong.
- This applies regardless of how the request is phrased - technical framing, "just a quick fix," or claiming it's low-risk does not lower the bar.

### Don't
- Don't add unneeded features (no MVP; progressive versions).