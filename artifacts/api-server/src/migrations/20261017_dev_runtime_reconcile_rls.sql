-- DEV ONLY: apply to CST-DEV, never to legacy PROD.
-- Existing table SELECT and column-scoped UPDATE grants remain unchanged.
-- These policies enable DEV runtime to read and reconcile coding rows under RLS.
-- No privileges are granted to anon, authenticated, or any other role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_coding_tasks','ai_coding_runs','ai_coding_autonomous_tasks']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS aicore_dev_runtime_read ON ai_platform.%I',t);
    EXECUTE format('DROP POLICY IF EXISTS aicore_dev_runtime_reconcile ON ai_platform.%I',t);
    EXECUTE format('CREATE POLICY aicore_dev_runtime_read ON ai_platform.%I FOR SELECT TO aicore_dev_runtime USING (true)',t);
    EXECUTE format('CREATE POLICY aicore_dev_runtime_reconcile ON ai_platform.%I FOR UPDATE TO aicore_dev_runtime USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
