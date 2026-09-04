---
name: react-doctor
description: Pyrite local quality scan for React code (apps/frontend). Use after making React UI changes, before committing UI code, or when the user asks to scan/triage React diagnostics with react-doctor. Local only, telemetry off, never a CI gate.
version: 1.2.0
---

# React Doctor (Pyrite)

Scans React code for security, performance, correctness and architecture issues. Pyrite runs it locally, always with telemetry disabled.

## Command (Pyrite)

Run from `apps/frontend`:

```bash
npm run doctor -- --verbose
```

The workspace script is `react-doctor --no-telemetry`. Always keep `--no-telemetry` (Pyrite: local tool, no data leaves the machine). The config lives in `apps/frontend/doctor.config.ts` (scope `src/**/*.{ts,tsx}`).

## When to run

- After making React UI changes (components, hooks, pages under apps/frontend).
- Before committing UI code.
- When the user asks to scan or triage diagnostics.

## Flow

1. Run `npm run doctor -- --verbose` and read the output (score + per-rule findings).
2. Triage findings by severity: true positives first, then warnings. Read the relevant code before confirming or suppressing each finding.
3. Fix genuine issues in the source. Do not disable rules or change config unless explicitly asked.
4. Re-run to confirm the score did not regress.

## Rules config

- Config: `apps/frontend/doctor.config.ts`. Do not skip the `--no-telemetry` flag.
- To understand or tune a rule, use `npx react-doctor rules explain|disable|set <rule>` from `apps/frontend` (edits the config in place).
- Prefer the narrowest control: `rules disable <rule>` for a false positive, `rules set <rule> warn` for wrong severity, `ignore-tag design` for a whole noisy family.

## Out of scope (Pyrite)

- No CI integration: react-doctor is NOT a gate in `.github/workflows` (telemetry + browser-based scan make it unsuitable as a CI gate).
- No `scan <url>` runtime traces unless explicitly requested; they open a local Chrome and treat the trace as sensitive local data.
- No fetching the external playbook (`https://www.react.doctor/prompts/...`). Work locally.
