# MIGRATION_RUNBOOK.md

> Branch: production-readiness-remediation  
> Date: 2026-07-23  
> Environment target: DEVELOPMENT / STAGING only — **never run production migrations without explicit go-live sign-off**

---

## Overview

This project uses Supabase PostgreSQL with all tables in the `ai_platform` schema. Migrations are managed via hand-written DDL scripts (not drizzle-kit push — see drizzle-push-false-positive memory note) executed through `artifacts/api-server/src/scripts/migrateSchemaToProd.ts`.

---

## Migration Files (Remediation Branch)

| File | Type | Idempotent | Status |
|------|------|-----------|--------|
| `services/signedUrlRevocationStore.ts` — `ensureRevocationTable()` | Additive DDL (CREATE TABLE IF NOT EXISTS) | ✅ Yes | Auto-runs on startup |
| Existing tables (ai_platform schema) | Established | ✅ Yes | Already applied to dev + prod |

---

## How to Apply Migrations

### Development

Migrations that use `CREATE TABLE IF NOT EXISTS` run automatically on API server startup (`ensureObservabilityTables`, `ensureSubmitIdempotencyTable`, and new `ensureRevocationTable` in signedUrlRevocationStore.ts).

For explicit DDL migrations:

```bash
# Dry-run first (reads env from development)
NODE_ENV=development pnpm --filter @workspace/scripts run migrate:prod:dry-run

# Apply (uses SUPABASE_DEV_DATABASE_URL)
NODE_ENV=development pnpm --filter @workspace/scripts run migrate:prod
```

### Production

**Never run production migrations during remediation. Requires explicit go-live sign-off.**

When approved:

```bash
# Always dry-run first
NODE_ENV=production pnpm --filter @workspace/scripts run migrate:prod:dry-run

# Review output, then apply
NODE_ENV=production pnpm --filter @workspace/scripts run migrate:prod
```

---

## Rollback Plan

| Migration | Rollback SQL | Risk |
|-----------|-------------|------|
| `signed_url_revocations` table | `DROP TABLE IF EXISTS ai_platform.signed_url_revocations;` | Low — table is additive, dropping it restores previous in-memory-only behavior |

---

## Safety Rules

1. **Dry-run before every apply** — the migration script supports `--dry-run` flag; always use it.
2. **No destructive statements without review** — `DROP`, `TRUNCATE`, `DELETE` without WHERE must be reviewed and approved.
3. **Additive-only policy** — new columns must have defaults; new tables use `IF NOT EXISTS`.
4. **Never ALTER production data** — data transformations require a backfill script separate from the DDL migration.
5. **No migration during deployment** — migrations run before traffic cut-over, never during.
6. **Failed migrations**: if `migrateSchemaToProd.ts` throws, the transaction rolls back. Check logs for the exact failing statement.
7. **Schema prefix**: always use `ai_platform.` prefix for all tables. The `SET search_path = ai_platform` is applied by the DB connection pool, but explicit prefixes are safer in migration scripts.

---

## Status Check

```bash
# Check which tables exist in dev
psql "$SUPABASE_DEV_DATABASE_URL" -c "\dt ai_platform.*"

# Check signed_url_revocations specifically
psql "$SUPABASE_DEV_DATABASE_URL" -c "SELECT COUNT(*) FROM ai_platform.signed_url_revocations;"
```

---

## AUTOMATED PAYMENT GATEWAY EXCLUDED FROM SCOPE BY PRODUCT DECISION.
