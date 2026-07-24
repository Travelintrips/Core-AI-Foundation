---
name: supabase-secret-name-mismatch
description: Imported project's Supabase DB secrets don't match the names the code expects
---

Development uses the tracked root `.env.development` file: the API dev script
passes it to Node with `--env-file`, so a fresh clone has the development
database configuration without manual `.env` copying. `lib/db/src/env.ts`
still resolves the canonical development and production variable names.

**Why:** The repository's intended clone-and-run experience is self-contained
for development, while production credentials remain deployment configuration.

**How to apply:** When diagnosing local development startup, verify that
`artifacts/api-server/package.json` still passes `--env-file=../../.env.development`
before asking the user for a Replit Secret. Production still needs its database
variable in the deployment environment.

Also: `pnpm --filter @workspace/db run push` may propose "delete ai_platform schema with N tables" as a false-positive full-recreation diff even when the live schema already matches. Never accept that data-loss prompt blindly — verify via `psql` (`select count(*) from information_schema.tables where table_schema='ai_platform'` and spot-check a seeded table) before deciding whether push is actually needed.
