-- DEV ONLY. Apply exclusively to the isolated AI Core DEV Supabase project.
-- Persist user-specific Dashboard dismissals without deleting jobs, events or ACKs.
-- Never apply in production or change the application role's permissions in PROD.
CREATE TABLE IF NOT EXISTS ai_platform.dev_monitor_dismissed_jobs (
  user_id bigint NOT NULL,
  job_key text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dev_monitor_dismissed_jobs_pkey PRIMARY KEY (user_id, job_key),
  CONSTRAINT dev_monitor_dismissed_jobs_key_format CHECK (
    job_key ~ '^(engine:[0-9]+|bridge:[0-9a-f-]{36}|execution:[0-9a-f-]{36})$'
  )
);
ALTER TABLE ai_platform.dev_monitor_dismissed_jobs ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
GRANT SELECT, INSERT, DELETE ON ai_platform.dev_monitor_dismissed_jobs TO aicore_dev_runtime;
DROP POLICY IF EXISTS dev_monitor_dismissed_jobs_runtime ON ai_platform.dev_monitor_dismissed_jobs;
CREATE POLICY dev_monitor_dismissed_jobs_runtime ON ai_platform.dev_monitor_dismissed_jobs
  FOR ALL TO aicore_dev_runtime USING (true) WITH CHECK (true);
