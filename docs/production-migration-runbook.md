# Production Migration Runbook
## Core AI Foundation — Material Library

**Repository:** Travelintrips/Core-AI-Foundation
**Schema:** `ai_platform` (Supabase PostgreSQL)
**Author:** Engineering Team
**Last updated:** 2026-07-27

> This runbook must be executable by an engineer unfamiliar with the project.
> Read every section completely before beginning. Never skip the pre-flight checklist.

---

## 1. Purpose

This runbook documents the controlled procedure for applying database schema migrations to the `ai_platform` schema in both development and production Supabase databases.

**Why hand-written DDL:** `drizzle-kit push` proposes dropping the entire `ai_platform` schema even for additive changes. It must never be used against any database containing seeded or customer data. All migrations are hand-written SQL files, applied manually by an engineer following this runbook.

---

## 2. Supported Environments

| Environment | Connection Variable | Schema | Applies To |
|---|---|---|---|
| Development | `SUPABASE_DATABASE_URL_DEV` | `ai_platform` | Local dev / Replit dev workspace |
| Production | `SUPABASE_DATABASE_URL` | `ai_platform` | Live customer-facing system |

**Never run production migrations without completing all pre-flight and backup steps first.**

---

## 3. Migration File Inventory (Ordered)

Apply migrations in this exact order. Each file is idempotent (`CREATE TABLE IF NOT EXISTS`) — safe to re-run if interrupted.

| Order | File | Phase | Tables Created |
|---|---|---|---|
| 1 | `20260716_design_render_zip_exports.sql` | Pre-material | design_render_zip_exports |
| 2 | `20260719_goal_taxonomy.sql` | Pre-material | goal_taxonomy |
| 3 | `20260719_service_normalization.sql` | Pre-material | service_normalization tables |
| 4 | `20260721_ai_entity_versions.sql` | Pre-material | ai_entity_versions |
| 5 | `20260724_provider_health_logs.sql` | Pre-material | provider_health_logs |
| 6 | `20260724_provider_health_tracking.sql` | Pre-material | provider_health_tracking |
| 7 | `perf_team37_indexes.sql` | Performance | Indexes only (no new tables) |
| 8 | `20260725_material_library.sql` | Phase 1–4 | material_categories, materials |
| 9 | `20260726_material_import_phase5.sql` | Phase 5 | material_import_staging, material_import_audit |

All files are located in: `artifacts/api-server/src/migrations/`

---

## 4. Pre-Flight Checklist

Complete every item before running any migration. Do not proceed if any item is blocked.

### Repository
- [ ] You are on the correct commit (`git rev-parse HEAD` matches intended release commit)
- [ ] Working tree is clean (`git status` shows no uncommitted changes)
- [ ] The migration file(s) to apply have been reviewed line-by-line by a second engineer

### Database
- [ ] You have confirmed which environment you are targeting (dev / production)
- [ ] You have the correct connection string for the target environment
- [ ] You have verified the connection is reachable: `psql <connection_string> -c "SELECT NOW();"`
- [ ] You have confirmed the `ai_platform` schema exists: `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'ai_platform';`
- [ ] You have confirmed current table count: `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ai_platform';`

### Backup (Production only — mandatory)
- [ ] Supabase point-in-time recovery is enabled on the production project
- [ ] You have noted the current timestamp before beginning (UTC): ________________
- [ ] You have confirmed with the product owner that a maintenance window is acceptable

### Communication
- [ ] Engineering lead has approved this migration run
- [ ] Team has been notified that migration is beginning
- [ ] Rollback engineer is on standby (contact: _______________)

---

## 5. Backup Procedure

### Development
Development database does not require a formal backup. Supabase dashboard provides manual snapshot capability if desired.

### Production (Mandatory)

**Step 1 — Confirm PITR is active**
```
In Supabase dashboard → Project Settings → Database → Point in Time Recovery
Confirm: PITR is enabled and retention period is shown
```

**Step 2 — Record pre-migration state**
```sql
-- Run via psql against production connection string
SET search_path = ai_platform;

-- Record table row counts
SELECT table_name, (xpath('/row/c/text()',
  query_to_xml(format('SELECT COUNT(*) AS c FROM ai_platform.%I', table_name), false, true, '')))[1]::TEXT::INT AS row_count
FROM information_schema.tables
WHERE table_schema = 'ai_platform'
ORDER BY table_name;
```

Save the output to a timestamped file: `migration-pre-state-YYYYMMDD-HHMMSS.txt`

**Step 3 — Note PITR recovery point**
```
Record exact UTC timestamp: ________________
This is your rollback point if the migration must be reversed.
```

---

## 6. Applying a Migration

### Method: psql direct execution

```bash
# Set the connection string for target environment
# Development:
CONNECTION="postgresql://postgres.xssrfshdrtdfupgqwfdw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres"

# Production:
CONNECTION="postgresql://postgres.nzdweipzckfszczzqtuw:<password>@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres"

# Apply a single migration file
psql "$CONNECTION" -f artifacts/api-server/src/migrations/<migration_file>.sql

# Verify no errors in output — look for:
# CREATE TABLE  (success)
# ERROR:        (failure — stop immediately)
```

### Applying multiple migrations
Apply each file individually in order. Do not pipe multiple files together — stop at the first error.

```bash
psql "$CONNECTION" -f artifacts/api-server/src/migrations/20260725_material_library.sql
# Verify output shows CREATE TABLE / no ERROR before continuing

psql "$CONNECTION" -f artifacts/api-server/src/migrations/20260726_material_import_phase5.sql
# Verify output
```

---

## 7. Verification Checklist

Run immediately after each migration file:

```sql
SET search_path = ai_platform;

-- Confirm new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'ai_platform'
ORDER BY table_name;

-- Confirm no unexpected tables were dropped
-- (compare with pre-migration table count)

-- For 20260725_material_library.sql — verify:
SELECT COUNT(*) FROM material_categories;  -- should be 13 after seed
SELECT COUNT(*) FROM materials;            -- should be 505 after seed

-- For 20260726_material_import_phase5.sql — verify:
SELECT COUNT(*) FROM material_import_staging;
SELECT COUNT(*) FROM material_import_audit;

-- Confirm indexes exist (sample)
SELECT indexname FROM pg_indexes
WHERE schemaname = 'ai_platform'
ORDER BY indexname;
```

---

## 8. Health Checks

After migration, run these checks before restarting the API server:

```bash
# 1. Schema readiness
curl -s https://aicore.cstlogistic.co.id/api/healthz/full
# Expected: {"database":"ok","schema":"ok","environment":"ok"}

# 2. Material catalog still accessible
curl -s https://aicore.cstlogistic.co.id/api/ai/catalog/public | python3 -c "import sys,json;d=json.load(sys.stdin);print('services:',sum(len(c.get('services',[])) for c in d.get('categories',[])))"
# Expected: services: 38 (or more)

# 3. Material search (development only — requires admin key)
curl -s -X POST http://localhost:8080/api/material-library/search \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"marble","limit":5}'
# Expected: results array with at least 1 hit
```

---

## 9. Rollback Procedure

### Scenario A: Migration failed mid-run (partial apply)

```sql
-- Connect to target database
SET search_path = ai_platform;

-- Check which tables were created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'ai_platform' ORDER BY table_name;

-- Drop partially created tables (example for Phase 5):
-- ROLLBACK DDL (from migration file header comments):
DROP TABLE IF EXISTS ai_platform.material_import_audit;
DROP TABLE IF EXISTS ai_platform.material_import_staging;
```

### Scenario B: Migration applied but production is broken (PITR)

1. **Do not restart the API server** — leave it offline to prevent further data corruption
2. In Supabase dashboard → Database → Backups → Point in Time Recovery
3. Select the timestamp recorded in Step 3 of the backup procedure
4. Initiate recovery to a new database instance
5. Update connection strings to point to recovered instance
6. Notify engineering lead immediately

### Scenario C: Data corruption discovered post-migration

1. Stop all API server workflows immediately
2. Notify engineering lead and product owner
3. Assess scope of corruption using audit logs (`material_import_audit`)
4. Determine whether PITR recovery or manual data correction is appropriate
5. Do not perform any further writes until root cause is identified

---

## 10. Failure Scenarios & Recovery Steps

| Scenario | Immediate Action | Recovery |
|---|---|---|
| `psql` connection refused | Check VPN / IP allowlist in Supabase dashboard | Add Replit's egress IP to Supabase allowlist |
| `ERROR: relation already exists` | Migration already applied — not an error if using `IF NOT EXISTS` | Verify table contents; mark migration as applied |
| `ERROR: column does not exist` | Schema drift between Drizzle schema and migration file | Fix migration file; do NOT apply partial state |
| `ERROR: permission denied for schema` | Wrong database user or schema not granted | Check Supabase role grants for `postgres` user on `ai_platform` |
| `ERROR: duplicate key value` | Seed was run before migration applied | Check for constraint conflicts; may need to truncate and re-seed |
| API server starts but returns 500 | Migration applied but code expects different schema | Roll back migration (Scenario A/B above) |
| Row counts drop unexpectedly | Migration had unexpected DROP | Initiate PITR immediately (Scenario B) |

---

## 11. Post-Migration Validation

After migration and API server restart, complete the following:

- [ ] `/api/healthz/full` returns `{"database":"ok","schema":"ok","environment":"ok"}`
- [ ] Material search returns results (admin API)
- [ ] Material import staging endpoint accessible
- [ ] Admin review queue loads (admin portal)
- [ ] No ERROR-level logs in API server startup sequence
- [ ] Row counts match pre-migration counts for all pre-existing tables
- [ ] New table row counts match expected post-seed values

Document actual results in: `docs/audits/migration-YYYYMMDD-result.md`

---

## 12. Production Approval Workflow

```
Engineer proposes migration
        │
        ▼
Second engineer reviews migration SQL line-by-line
        │
        ▼
Engineering lead approves (sign-off required)
        │
        ▼
Product owner notified of maintenance window
        │
        ▼
Pre-flight checklist completed
        │
        ▼
Backup / PITR point recorded
        │
        ▼
Migration applied (engineer + rollback engineer on standby)
        │
        ▼
Verification checklist completed
        │
        ▼
Health checks pass
        │
        ▼
Post-migration result documented
        │
        ▼
Engineering lead signs off: MIGRATION COMPLETE
```

## Required Sign-offs

| Role | Name | Date | Signature |
|---|---|---|---|
| Migration author | | | |
| Reviewer (second engineer) | | | |
| Engineering lead | | | |
| Product owner (production only) | | | |
