-- DEV ONLY. Storage for signed REVIEW INTENT, not an actionable resume grant.
CREATE TABLE IF NOT EXISTS ai_platform.dev_gpt02_operator_review_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 command_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id),
 checkpoint_response_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_responses(id),
 blocker_response_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_responses(id),
 operator_user_id integer NOT NULL REFERENCES ai_platform.internal_users(id),
 operator_role text NOT NULL CHECK (operator_role IN ('owner','admin')),
 worker_id text NOT NULL CHECK (worker_id='openclaw-dell-chatgpt-wake-dev'),
 action text NOT NULL DEFAULT 'gpt02.resume.grant.review'
   CHECK (action='gpt02.resume.grant.review'),
 nonce text NOT NULL UNIQUE CHECK (nonce ~ '^[a-f0-9]{64}$'),
 proof_json jsonb NOT NULL CHECK (jsonb_typeof(proof_json)='object'),
 signed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (checkpoint_response_id <> blocker_response_id),
 CHECK (expires_at > signed_at),
 CHECK (expires_at <= signed_at + interval '120 seconds'),
 CHECK (recorded_at <= expires_at)
);
CREATE INDEX IF NOT EXISTS dev_gpt02_review_intents_command_lookup
 ON ai_platform.dev_gpt02_operator_review_intents(command_id,recorded_at DESC);
ALTER TABLE ai_platform.dev_gpt02_operator_review_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ai_platform.dev_gpt02_operator_review_intents
 FROM PUBLIC,anon,authenticated;
-- No RLS policies. No SECURITY DEFINER, no function and no public grants.
-- This table carries no resume authority and has no worker-executable claim path.
