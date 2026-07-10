---
name: supabase-schema-migration
description: Migrating a Drizzle/Postgres app off Replit's built-in DB onto a shared Supabase project without colliding with its crowded public schema.
---

When a user shares one Supabase project's `public` schema across multiple apps, put the app's tables in a dedicated Postgres schema (e.g. `pgSchema("ai_platform")` in Drizzle, used as `appSchema.table(...)` instead of `pgTable(...)`), not `public`.

**Why:** the user explicitly rejected `public` because it already had too many unrelated tables from other apps in the same Supabase project.

**How to apply:**
- Define one `pgSchema(name)` and swap every `pgTable(` call to `appSchema.table(`.
- Raw SQL (outside the Drizzle query builder) uses unqualified table names, so schema-qualifying only the Drizzle definitions is not enough — also set the search_path on every new pool connection, otherwise raw queries silently miss the new schema. Do this via the `pg.Pool({ options: "-c search_path=<schema>,public" })` startup parameter, NOT `pool.on("connect", client => client.query("SET search_path..."))` — the latter races with the pool handing the connection to the first real query (the `connect` listener isn't awaited), causing intermittent "relation ... does not exist" errors under concurrency.
- `drizzle-kit push` needs the schema to exist first (`CREATE SCHEMA IF NOT EXISTS ...`) and add `schemaFilter: [name]` to `drizzle.config.ts` so it doesn't try to diff `public`.
- `drizzle-kit push` against a schema that already has all 46 tables sometimes falsely reports "about to delete the schema with N tables" and then fails needing a TTY confirmation — this is a spurious diff, not real drift; verify with `\dt <schema>.*` before worrying about it, don't force-push blindly.
- For separate dev/prod Postgres URLs, pick the URL based on `NODE_ENV` in one shared resolver function rather than overloading the platform-managed `DATABASE_URL` var (which the environment reserves as runtime-managed and app code shouldn't repurpose).
- To copy existing data across: `pg_dump --schema=public --data-only --no-owner --no-privileges`, then `sed 's/public\./<newschema>./g'` on the dump, then restore with plain `psql` (not `--disable-triggers`/`session_replication_role`, both need superuser which managed Postgres providers like Supabase don't grant).
- **Re-import gotcha:** after a GitHub re-import, `.replit` userenv may only have the connection string under a different key (e.g. `SUPABASE_DATABASE_URL_DEV`) than what code expects (`SUPABASE_DEV_DATABASE_URL`). Check `lib/db/src/env.ts` for the exact expected var names and add the correctly-named env var if missing.
