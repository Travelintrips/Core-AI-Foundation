# P1.1 Rollback Notes

## What was changed
Additive DDL only — no existing tables modified, no data altered.

## Rollback SQL (if needed)

```sql
SET search_path TO ai_platform, public;

-- Drop new tables (only if safe — check for data first)
DROP TABLE IF EXISTS ai_platform.ai_customer_documents;
DROP TABLE IF EXISTS ai_platform.ai_customer_impersonation_tokens;

-- Drop new indexes on existing tables (non-destructive — data is unaffected)
DROP INDEX IF EXISTS ai_platform.idx_cdt_email_hash;
DROP INDEX IF EXISTS ai_platform.idx_cdt_expires_at;
DROP INDEX IF EXISTS ai_platform.idx_cnr_email_hash;
DROP INDEX IF EXISTS ai_platform.idx_cst_email_hash;
DROP INDEX IF EXISTS ai_platform.idx_cst_status;
DROP INDEX IF EXISTS ai_platform.idx_cst_created_at;
DROP INDEX IF EXISTS ai_platform.idx_cp_status;
DROP INDEX IF EXISTS ai_platform.idx_cp_payment_status;
DROP INDEX IF EXISTS ai_platform.idx_cp_created_at;
DROP INDEX IF EXISTS ai_platform.idx_asr_customer_email;
DROP INDEX IF EXISTS ai_platform.idx_asr_status;
DROP INDEX IF EXISTS ai_platform.idx_ai_project_id;
DROP INDEX IF EXISTS ai_platform.idx_ai_status;
DROP INDEX IF EXISTS ai_platform.idx_aps_project_id;
DROP INDEX IF EXISTS ai_platform.idx_aps_status;
DROP INDEX IF EXISTS ai_platform.idx_cp_profile_email_hash;
DROP INDEX IF EXISTS ai_platform.idx_aal_resource_id;
DROP INDEX IF EXISTS ai_platform.idx_aal_created_at;
DROP INDEX IF EXISTS ai_platform.idx_cacr_client_email;
```

## Backup checklist (before production apply)
- [ ] Full schema backup: `pg_dump --schema=ai_platform --schema-only`
- [ ] Data snapshot of affected tables: `customer_dashboard_tokens`, `ai_invoices`
- [ ] Verify backup file integrity before proceeding
- [ ] Note current row counts for post-check verification

## Post-check after apply
```sql
-- Verify new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'ai_platform'
  AND table_name IN ('ai_customer_documents', 'ai_customer_impersonation_tokens');
-- Expected: 2 rows

-- Verify indexes
SELECT indexname FROM pg_indexes WHERE schemaname = 'ai_platform' AND indexname LIKE 'idx_acd_%';
-- Expected: 4 rows
```
