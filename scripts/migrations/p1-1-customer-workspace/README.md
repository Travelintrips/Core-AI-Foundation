# Sprint P1.1 — Production Migration Package

**Sprint**: Customer Workspace — API Standardization, Invoice PDF, Security Audit  
**Status**: Ready for staging apply  
**Type**: Additive-only (no DROP, no TRUNCATE, no data overwrite)

## Files

| File | Purpose |
|------|---------|
| `preflight.sql` | Run FIRST — checks preconditions, returns errors if unsafe |
| `migration.sql` | Main DDL — creates new tables and indexes |
| `rollback_notes.md` | Manual rollback SQL if needed |
| `README.md` | This file |

## What changes

### New tables
- `ai_platform.ai_customer_documents` — Server-generated PDF invoice documents
- `ai_platform.ai_customer_impersonation_tokens` — Short-lived admin impersonation sessions (separate from customer real tokens)

### New indexes on existing tables
- `customer_dashboard_tokens`: `email_hash`, `expires_at`
- `creative_projects`: `status`, `payment_status`, `created_at`
- `ai_service_requests`: `customer_email`, `status`
- `ai_invoices`: `project_id`, `status`
- `ai_payment_schedule`: `project_id`, `status`
- `customer_notification_reads`: `email_hash`
- `customer_support_tickets`: `email_hash`, `status`, `created_at`
- `customer_profiles`: `email_hash`
- `ai_audit_logs`: `resource_id`, `created_at`
- `creative_ai_client_reviews`: `client_email`

## Commands

### DEV
```bash
psql "$SUPABASE_DEV_DATABASE_URL" -f preflight.sql
psql "$SUPABASE_DEV_DATABASE_URL" -f migration.sql
```

### STAGING
```bash
psql "$SUPABASE_STAGING_DATABASE_URL" -f preflight.sql
# Review preflight output — proceed only if "PREFLIGHT OK" returned
psql "$SUPABASE_STAGING_DATABASE_URL" -f migration.sql
```

### PRODUCTION (requires explicit confirmation)
```bash
# Step 1: Backup
pg_dump "$SUPABASE_DATABASE_URL" --schema=ai_platform --schema-only > backup_$(date +%Y%m%d).sql

# Step 2: Preflight
psql "$SUPABASE_DATABASE_URL" -f preflight.sql
# STOP if any ERROR rows returned

# Step 3: Apply (requires human confirmation)
APPLY_PRODUCTION=yes psql "$SUPABASE_DATABASE_URL" -f migration.sql
# (Production guard: remove the APPLY_PRODUCTION check if using psql directly)

# Step 4: Post-check
psql "$SUPABASE_DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='ai_platform' AND table_name IN ('ai_customer_documents','ai_customer_impersonation_tokens');"
```

## Known limitations
- PDF files stored in `/tmp/customer-docs/` — ephemeral in Replit dev. For production, move to object storage (S3/GCS/R2) and update `storagePath` column to use object storage keys.
- `storage_path` column intentionally never returned to clients.
