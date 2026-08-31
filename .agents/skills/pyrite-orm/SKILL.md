---
name: pyrite-orm
description: Mandatory procedure and safety rules for any Drizzle ORM/database schema change in Pyrite (generate, migrate, push, studio). Use before running ANY command that touches apps/backend/drizzle/ or modifies the database schema/data — including via npm run orm*. Read this BEFORE executing, not after.
---

# Pyrite — Database & ORM Safety

This skill is mandatory reading before running any `npm run orm*` command, editing `apps/backend/drizzle/schema.ts`, or executing any SQL migration. Do not skip steps to save time — database changes are the highest-risk action in this project.

## Mandatory flow

1. Edit `apps/backend/drizzle/schema.ts`.
2. Run `npm run tsc` — must pass with zero errors before continuing. If it fails, stop and fix; do not proceed to step 3.
3. Run `npm run orm` (= `orm:generate`) — this only writes a `.sql` file to `drizzle/migrations/`. It does **not** touch the real database.
4. **Read the generated `.sql` file in full before doing anything else.** Specifically check for:
   - `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN ... TYPE` (data-loss risk)
   - Any statement affecting a table that may already hold real user data
5. If the `.sql` contains any destructive statement (see above), **stop and show it to the user explicitly, in plain language** ("this will permanently delete column X and its data"). Do not run `orm:migrate` without explicit confirmation for destructive changes.
6. Only after review: run `npm run orm:migrate` to apply.

## Commands — what each one does and when

| Command | Effect | When to use |
|---|---|---|
| `npm run orm` / `orm:generate` | Writes migration `.sql`, does not apply it | Every schema change, always the first step |
| `npm run orm:migrate` | Applies pending migrations to the real DB | After reviewing the `.sql`, step 6 above |
| `npm run orm:push` | Applies schema directly, no migration file, no history | **Early prototyping only**, no real data at risk. Never on data you'd mind losing. |
| `npm run orm:studio` | Opens local inspection UI, read-only browsing | Anytime, safe — does not modify anything |

## Hard restrictions

- **Never run `orm:push` if the database contains any data the user hasn't explicitly said is disposable.**
- **Never run `orm:migrate` on a destructive migration without explicit user confirmation for that specific migration.** A prior "go ahead" for a different change does not carry over.
- **Never write raw SQL directly against the database outside of the generate → review → migrate flow**, even for "quick fixes."
- **Never delete data (`DROP`, `DELETE`, `TRUNCATE`) via any path — CLI, script, or direct query — without asking for confirmation three separate times**, each time restating exactly what will be deleted and that it is irreversible.

## Don't
- Don't skip the `tsc` check to save time.
- Don't apply a migration you haven't personally read.
- Don't assume "it's probably fine" for any `DROP`/`ALTER` — always flag it.