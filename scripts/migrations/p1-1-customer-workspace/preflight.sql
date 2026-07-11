-- ============================================================
-- P1.1 Preflight Check — Run BEFORE migration.sql
-- Returns 0 rows = safe to proceed. Any rows = blocker found.
-- ============================================================

SET search_path TO ai_platform, public;

-- Check 1: ai_customer_documents table does NOT already exist
SELECT 'ERROR: ai_customer_documents already exists' AS check_result
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai_platform' AND table_name = 'ai_customer_documents'
);

-- Check 2: ai_customer_impersonation_tokens table does NOT already exist
SELECT 'ERROR: ai_customer_impersonation_tokens already exists' AS check_result
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai_platform' AND table_name = 'ai_customer_impersonation_tokens'
);

-- Check 3: target schema exists
SELECT 'ERROR: ai_platform schema does not exist' AS check_result
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ai_platform'
);

-- Check 4: Required base tables exist
SELECT 'ERROR: customer_dashboard_tokens missing' AS check_result
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai_platform' AND table_name = 'customer_dashboard_tokens'
);

SELECT 'ERROR: creative_projects missing' AS check_result
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai_platform' AND table_name = 'creative_projects'
);

SELECT 'ERROR: ai_invoices missing' AS check_result
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai_platform' AND table_name = 'ai_invoices'
);

-- Check 5: No constraint name conflict for uq_customer_doc_number
SELECT 'ERROR: constraint uq_customer_doc_number already exists' AS check_result
WHERE EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'ai_platform' AND constraint_name = 'uq_customer_doc_number'
);

SELECT 'PREFLIGHT OK — safe to apply migration.sql' AS check_result
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai_platform' AND table_name = 'ai_customer_documents'
) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai_platform' AND table_name = 'ai_customer_impersonation_tokens'
) AND EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ai_platform'
);
