-- Reviewed DEV migration only. Run as the protected migration owner.
BEGIN;
DO $$ BEGIN
  IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true'
    OR current_setting('ai_core.dev_project_ref',true) IS DISTINCT FROM 'xssrfshdrtdfupgqwfdw' THEN
    RAISE EXCEPTION 'Explicit CST-DEV migration context required';
  END IF;
END $$;
-- Null identifies a mandate created by the authenticated Owner route.
-- Preserve historical signed records and the once-only permit ledger.
ALTER TABLE task189_release.grants ALTER COLUMN signature DROP NOT NULL;
COMMIT;
