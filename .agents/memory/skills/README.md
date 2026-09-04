# Skills - Pyrite

## Project-owned
| Skill | When |
|---|---|
| `pyrite-orm` | Mandatory - before any `npm run orm*` command or `drizzle/schema.ts` edit. Safety rules and destructive-change flow for the database. |

## Installed from environment (apply only when relevant, always customized)
| Skill | When |
|---|---|
| `spec-creation` | starting a new feature/fix that needs an SDD spec - creates the spec file and registers it in `features.md` |
| `frontend-design` | designing new UI or reshaping existing UI in `apps/frontend` - visual direction, typography, avoiding templated defaults |
| `web-design-guidelines` | auditing UI code in `apps/frontend` against Vercel's Web Interface Guidelines (accessibility, spacing, interaction) before merging UI changes |
| `react-doctor` | local React quality scan in `apps/frontend` (script `npm run doctor`) - after UI changes, before committing UI code. Telemetry off, not a CI gate |


> Rule: never fork/copy-paste a skill without customizing it to Pyrite (see `AGENTS.md`).

## Note
- The `.agents/skills/` folder is auto-generated on install in other systems; here it holds both the project-owned `pyrite-orm` skill and environment-installed ones.