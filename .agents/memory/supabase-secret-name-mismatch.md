---
name: supabase-secret-name-mismatch
description: Imported project's Supabase DB secrets don't match the names the code expects
---

`lib/db/src/env.ts` (`resolveDatabaseUrl()`) reads `SUPABASE_DEV_DATABASE_URL` and `SUPABASE_PROD_DATABASE_URL`.

The Replit-side secrets for this project are actually named `SUPABASE_DATABASE_URL_DEV` (dev) and `SUPABASE_DATABASE_URL` (prod, in the production environment) — a leftover from an earlier import/setup pass.

**Why:** Without aliasing, the API server throws "SUPABASE_DEV_DATABASE_URL must be set" on boot even though a working Supabase URL exists under a different name.

**How to apply:** If DB connection fails after a fresh import, check both possible names before asking the user for a new secret. Fix by adding the correctly-named secret with the same value (`setEnvVars`), not by renaming/deleting the original, and not by editing `env.ts` (keep the code/name convention stable).

Also: `pnpm --filter @workspace/db run push` may propose "delete ai_platform schema with N tables" as a false-positive full-recreation diff even when the live schema already matches. Never accept that data-loss prompt blindly — verify via `psql` (`select count(*) from information_schema.tables where table_schema='ai_platform'` and spot-check a seeded table) before deciding whether push is actually needed.
