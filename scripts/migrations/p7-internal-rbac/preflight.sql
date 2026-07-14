-- Preflight checks for P7 Internal RBAC migration.
-- Run this FIRST. Every row returned should say "OK" — if any says
-- "ERROR", stop and investigate before applying migration.sql.

SET search_path TO ai_platform, public;

SELECT 'internal_users table' AS check_name,
       CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'ai_platform' AND table_name = 'internal_users'
       ) THEN 'ERROR: table already exists — review before re-applying' ELSE 'OK: does not exist yet' END AS result
UNION ALL
SELECT 'ai_service_categories.visibility column',
       CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'ai_platform' AND table_name = 'ai_service_categories' AND column_name = 'visibility'
       ) THEN 'OK: already present (migration is idempotent, safe to re-run)' ELSE 'OK: will be added' END
UNION ALL
SELECT 'ai_service_categories table exists',
       CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'ai_platform' AND table_name = 'ai_service_categories'
       ) THEN 'OK' ELSE 'ERROR: base table missing — run earlier catalog migration first' END
UNION ALL
SELECT 'creative category exists',
       CASE WHEN EXISTS (
           SELECT 1 FROM ai_platform.ai_service_categories WHERE code = 'creative'
       ) THEN 'OK' ELSE 'ERROR: no row with code=creative — seed the catalog first' END;
