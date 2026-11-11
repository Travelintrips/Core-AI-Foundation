-- GPT02 Issue #159 — DEV-only, read-only lifecycle catalogue preflight.
-- NO DDL, DML, task, command, approval, signer, nonce consumption or dispatch.
-- The outcome intentionally remains NO_GO until reviewed operational migration.
WITH required_functions(function_name) AS (
  VALUES ('prepare_core_task'), ('record_linked_approval'),
         ('consume_linked_approval'), ('reserve_post_consumption_fence'),
         ('record_issuer_evidence'), ('consume_issuer_lease')
),
function_checks AS (
  SELECT function_name,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('gpt02_stage','gpt02_private')
        AND p.proname=function_name
    ) AS available
  FROM required_functions
),
table_checks AS (
  SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('gpt02_stage','gpt02_private') AND c.relkind='r'
),
constraint_checks AS (
  SELECT con.conname, c.relname, pg_catalog.pg_get_constraintdef(con.oid) AS definition
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='gpt02_private'
    AND c.relname IN ('core_identity_receipts','post_consumption_fences')
    AND con.contype='c'
    AND con.conname ~ '(dispatch|binding_verified|lease_epoch|may_issue_grant|core_ledger_written)'
)
SELECT
  (SELECT count(*) FROM function_checks WHERE available) AS installed_functions,
  (SELECT count(*) FROM function_checks) AS required_functions,
  (SELECT count(*) FROM table_checks WHERE relrowsecurity AND relforcerowsecurity) AS rls_forced_tables,
  (SELECT count(*) FROM table_checks) AS lifecycle_tables,
  (SELECT count(*) FROM constraint_checks) AS fail_closed_constraints,
  CASE WHEN (SELECT count(*) FROM function_checks WHERE available)=6
     AND (SELECT count(*) FROM table_checks WHERE relrowsecurity AND relforcerowsecurity)=6
     AND (SELECT count(*) FROM constraint_checks)>=7
    THEN 'CATALOG_PREREQUISITES_PRESENT_NOT_E2E_AUTHORIZED'
    ELSE 'NO_GO_REVIEW_REQUIRED'
  END AS lifecycle_release_gate;
