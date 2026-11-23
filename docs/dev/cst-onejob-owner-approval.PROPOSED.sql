-- PROPOSED ONLY — DO NOT APPLY without isolated SQL rehearsal and security review.
-- CST-DEV xssrfshdrtdfupgqwfdw, NOT PROD.
-- One approval by an authenticated internal Owner creates exactly one WAITING job.
-- No worker may claim the job until a separate fail-closed admission moves it to queued.
CREATE TABLE IF NOT EXISTS ai_platform.cst_onejob_owner_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL DEFAULT 'CST_DEV_ONEJOB_MODEL'
    CHECK (purpose='CST_DEV_ONEJOB_MODEL'),
  status text NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('APPROVED','EXPIRED','CONSUMED')),
  company_id text NOT NULL CHECK (company_id='1'),
  model_id text NOT NULL CHECK (model_id='qwen2.5:3b'),
  approved_by_user_id integer NOT NULL REFERENCES ai_platform.internal_users(id),
  request_id text NOT NULL UNIQUE
    CHECK (request_id ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'),
  worker_name text NOT NULL
    CHECK (worker_name ~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'),
  source_sha text NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at>approved_at AND expires_at<=approved_at+interval '30 minutes'),
  CHECK ((status='CONSUMED') = (consumed_at IS NOT NULL))
);
-- Exactly one active Company-1 pilot at a time. Unique request and job IDs
-- alone do not prevent parallel requests with different randomly generated IDs.
-- A completed/expired pilot needs an explicitly audited transition to EXPIRED
-- before any next pilot can be staged; the expiry timestamp is NOT automatic.
CREATE UNIQUE INDEX IF NOT EXISTS cst_onejob_one_active_approval
 ON ai_platform.cst_onejob_owner_approvals (company_id)
 WHERE status IN ('APPROVED','CONSUMED');

ALTER TABLE ai_platform.cst_onejob_owner_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.cst_onejob_owner_approvals FORCE ROW LEVEL SECURITY;
-- Intentionally no GRANT or policy in this proposal. Deployment must provide
-- an explicitly reviewed, DEV-only application writer policy/role and transaction
-- binding; generic public, anon, authenticated or worker access is forbidden.
-- No updates/deletes to existing ai_jobs, GPT02 rows, or PROD.
