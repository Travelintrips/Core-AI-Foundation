-- DEV-ONLY: read-only diagnostics for the authenticated operator review endpoint.
-- NEVER apply to PROD. Execute only after verifying the target DB is CST-DEV.
-- Requires the review-intents storage migration and existing runtime role.
-- Review signatures and command state are verified by the API, not this policy.
BEGIN;
DO $guard$
DECLARE
  p record;
BEGIN
  IF to_regclass('ai_platform.dev_gpt02_operator_review_intents') IS NULL THEN
    RAISE EXCEPTION 'GPT02_DEV_REVIEW_TABLE_MISSING' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') THEN
    RAISE EXCEPTION 'GPT02_DEV_RUNTIME_ROLE_MISSING' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid='ai_platform.dev_gpt02_operator_review_intents'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'GPT02_DEV_REVIEW_RLS_DISABLED' USING ERRCODE='P0001';
  END IF;
  SELECT polname,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid) AS qual,
         pg_get_expr(polwithcheck,polrelid) AS with_check
  INTO p
  FROM pg_policy
  WHERE polrelid='ai_platform.dev_gpt02_operator_review_intents'::regclass
    AND polname='dev_gpt02_review_runtime_select';
  IF FOUND AND NOT (
    p.polcmd='r' AND p.polpermissive
    AND p.polroles=ARRAY['aicore_dev_runtime'::regrole::oid]
    AND p.qual='true' AND p.with_check IS NULL
  ) THEN
    RAISE EXCEPTION 'GPT02_DEV_REVIEW_SELECT_POLICY_DRIFT'
      USING ERRCODE='P0001';
  END IF;
END;
$guard$;
GRANT SELECT ON TABLE ai_platform.dev_gpt02_operator_review_intents TO aicore_dev_runtime;
DO $create$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid='ai_platform.dev_gpt02_operator_review_intents'::regclass
      AND polname='dev_gpt02_review_runtime_select'
  ) THEN
    EXECUTE 'CREATE POLICY dev_gpt02_review_runtime_select
      ON ai_platform.dev_gpt02_operator_review_intents
      AS PERMISSIVE FOR SELECT TO aicore_dev_runtime USING (true)';
  END IF;
END;
$create$;
COMMIT;
