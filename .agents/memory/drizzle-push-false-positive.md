---
name: drizzle-kit push false-positive schema drop
description: drizzle-kit push in this project prompts to drop/recreate the whole ai_platform schema even for pure additive changes, and requires an interactive TTY it doesn't have here.
---

`drizzle-kit push` (and `--verbose`) hangs/loops on introspection and proposes destructive "delete schema" statements even when the only real change is new tables. It also can't run non-interactively in this sandbox.

**Why:** Likely an introspection/diffing quirk specific to the dedicated `ai_platform` Postgres schema setup (Supabase) — not confirmed root-caused, and `--force` risks blindly applying a real data-loss statement if the diff is ever genuine.

**How to apply:** For purely additive schema changes (new tables only, no column/type changes to existing tables), skip `drizzle-kit push` entirely — hand-write the `CREATE TABLE IF NOT EXISTS ...` DDL (matching the Drizzle schema exactly) and apply it directly via `psql "$SUPABASE_DEV_DATABASE_URL" -f file.sql` with `SET search_path TO ai_platform;` at the top. Verify row/table counts before and after. Do not use `--force` on this project without first confirming the exact statements via a safer diff method.

**Also applies to new unique constraints:** `drizzle-kit push --force` does not suppress every prompt — adding a unique constraint to a table with existing rows still shows an interactive "insert failed, truncate table?" suggestion and hangs (stdin closed) even with `--force`. Same workaround: hand-write `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...)` via psql after checking for duplicate values, instead of relying on `push`/`push-force`.
