# P7 — Internal RBAC & Customer/Internal Portal Separation

**Type**: Additive-only (no DROP, no TRUNCATE, no data overwrite)

## What changes

### New table
- `ai_platform.internal_users` — company staff accounts (email + bcrypt password hash + role), completely separate from `customer_profiles`.

### New columns
- `ai_platform.ai_service_categories.visibility` (`public` | `internal` | `disabled`) — default `internal`; `creative` is flipped to `public`.
- `ai_platform.ai_service_categories.commercial_status` (`commercial_ready` | `internal_only` | `beta` | `disabled`) — default `internal_only`; `creative` is flipped to `commercial_ready`.

No existing customer or category rows are deleted. All 14 non-Creative categories remain in the database, just marked `internal`.

## Commands

```bash
psql "$SUPABASE_DEV_DATABASE_URL" -f preflight.sql
psql "$SUPABASE_DEV_DATABASE_URL" -f migration.sql
```

For staging/production, follow the same pattern used in `scripts/migrations/p1-1-customer-workspace/README.md` (backup schema-only dump, preflight, explicit confirmation before applying).

## Rollback

```sql
ALTER TABLE ai_platform.ai_service_categories DROP CONSTRAINT IF EXISTS chk_ai_service_categories_visibility;
ALTER TABLE ai_platform.ai_service_categories DROP CONSTRAINT IF EXISTS chk_ai_service_categories_commercial_status;
ALTER TABLE ai_platform.ai_service_categories DROP COLUMN IF EXISTS visibility;
ALTER TABLE ai_platform.ai_service_categories DROP COLUMN IF EXISTS commercial_status;
DROP TABLE IF EXISTS ai_platform.internal_users;
```
