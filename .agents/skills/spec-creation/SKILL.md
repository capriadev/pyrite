---
name: spec-creation
description: Create a new spec-driven-development (SDD) spec — generates the spec file and registers it in the project's feature index with the correct next ID, then verifies the registration is consistent. Use when the user wants to start a new feature, fix, or any code change that needs a spec before implementation begins, in any project using an SDD/features-index pattern.
---

# Spec Creation

Mechanical procedure to open a new spec, in any project using a features-index + specs-folder pattern (the pattern isn't Pyrite-specific — it's a project convention this skill detects, not assumes).

## Preconditions — detect the convention, don't hardcode it

1. Locate the features index: search the repo for a file matching `features.md` (or ask the user if none is found — common locations: `agents/memory/`, `.agents/`, `docs/`, repo root).
2. Confirm it has a `last_id:` line and a specs folder alongside it (commonly `specs/` next to the index, or referenced explicitly inside it). If either is missing or ambiguous, stop and ask — do not guess the path or invent an ID.
3. Note the naming pattern already in use in the specs folder (`NNN-kebab-case.md` is the Pyrite convention; confirm it matches what's already there before assuming it for a new project).

## Steps

1. **Get the next ID.** Read `last_id: N` from the index. New ID = `N + 1`. Never reuse a deleted or completed ID.

2. **Confirm scope** with the user if unclear: one spec = one atomic objective. If the request bundles more than one objective, stop and propose splitting before creating any file.

3. **Create the spec file** at `<specs-folder>/NNN-descriptive-name.md` using the format already established in that folder. If no prior spec exists to infer format from, use:

```markdown
   # <Feature name>

   ## Objective
   <one paragraph — what this achieves and why>

   ## Scope
   - In scope: <bullets>
   - Out of scope: <bullets>

   ## Approach
   <how it will be built — layers touched, key decisions>

   ## Acceptance criteria
   - [ ] <verifiable condition>
   - [ ] <verifiable condition>

   ## Status
   pending
```

4. **Register in the index**, matching its existing line format exactly (read 1-2 existing entries first, don't assume the format). Update the `last_id:` line in the same edit — never one without the other.

5. **Verify before confirming** (this is what makes it a tool, not a prompt):
   - Re-read the index file. Confirm the new line is present and `last_id` matches the ID just used.
   - Confirm the spec file exists on disk at the expected path.
   - Confirm no other spec file already claims the same ID (list the folder, check for collisions).
   - If any check fails, report the mismatch explicitly — do not silently retry or paper over it.

6. **Confirm to the user**: spec file path + assigned ID + verification result. Do not start implementing unless explicitly asked.

## Edge cases
- **Spec too large**: split before creating files.
- **ID collision on disk**: index is out of sync with disk — stop, report, do not overwrite.
- **Similar spec already exists**: ask if this is a revision instead of new.
- **No SDD convention detected in this repo at all**: ask the user if they want to bootstrap one (create `features.md` with `last_id: 0` and a `specs/` folder) rather than assuming Pyrite's exact structure.