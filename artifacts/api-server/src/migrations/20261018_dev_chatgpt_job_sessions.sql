-- DEV ONLY. Review and apply to CST-DEV after verifying project identity.
-- No automatic execution. Never run against PROD.
-- An attestation boolean alone is not proof of browser ownership; the
-- authenticated worker/control plane must validate the evidence separately.
BEGIN;
CREATE TABLE IF NOT EXISTS ai_platform.ai_chatgpt_job_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_alias text NOT NULL CHECK (account_alias ~ '^GPT[0-9]{2,6}$'),
  job_alias text NOT NULL CHECK (job_alias ~ '^JOB[0-9]{2,12}$'),
  conversation_id text NOT NULL CHECK (conversation_id ~ '^[A-Za-z0-9-]{10,100}$'),
  conversation_url text NOT NULL,
  attestation_evidence jsonb NOT NULL,
  attested_worker_id text NOT NULL,
  attested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_chatgpt_job_sessions_url_matches CHECK (
    conversation_url = 'https://chatgpt.com/c/' || conversation_id
  ),
  CONSTRAINT ai_chatgpt_job_sessions_worker_nonempty CHECK (length(trim(attested_worker_id)) > 0),
  CONSTRAINT ai_chatgpt_job_sessions_evidence_object CHECK (
    jsonb_typeof(attestation_evidence) = 'object'
    AND attestation_evidence <> '{}'::jsonb
  ),
  CONSTRAINT ai_chatgpt_job_sessions_job_unique UNIQUE (account_alias, job_alias),
  CONSTRAINT ai_chatgpt_job_sessions_conversation_unique UNIQUE (account_alias, conversation_id)
);
ALTER TABLE ai_platform.ai_chatgpt_job_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_chatgpt_job_sessions FORCE ROW LEVEL SECURITY;
-- No permissive policies or grants here: deny all access until reviewed
-- authenticated DEV owner/worker read and registration policies are installed.
COMMIT;
