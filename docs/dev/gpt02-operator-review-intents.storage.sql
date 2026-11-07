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

-- Existing DEV deployments are upgraded idempotently. This validates
-- correspondence of the stored signed fields with indexed audit columns.
-- It is defense in depth, not database-side cryptographic verification.
DO $review$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid='ai_platform.dev_gpt02_operator_review_intents'::regclass
     AND conname='dev_gpt02_review_proof_binding_ck'
 ) THEN
   ALTER TABLE ai_platform.dev_gpt02_operator_review_intents
     ADD CONSTRAINT dev_gpt02_review_proof_binding_ck CHECK (
       (
         proof_json->>'version'='1'
         AND proof_json->>'action'=action
         AND proof_json->>'commandId'=command_id::text
         AND proof_json->>'checkpointResponseId'=checkpoint_response_id::text
         AND proof_json->>'blockerResponseId'=blocker_response_id::text
         AND proof_json->>'workerId'=worker_id
         AND proof_json->>'operatorId'='internal:'||operator_user_id::text
         AND proof_json->>'operatorRole'=operator_role
         AND proof_json->>'nonce'=nonce
         AND proof_json->>'issuedAt' IS NOT NULL
         AND proof_json->>'expiresAt' IS NOT NULL
         AND proof_json->>'signatureBase64' ~ '^[A-Za-z0-9+/]{86}==$'
       ) IS TRUE
     );
 END IF;
END;
$review$;

-- An auditable human review intent must be append-only. Even if a privileged
-- API role accidentally receives UPDATE/DELETE, historical proof may not be
-- rewritten or discarded via regular DML. No SECURITY DEFINER privilege.
CREATE OR REPLACE FUNCTION ai_platform.dev_gpt02_review_intent_immutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,ai_platform
AS $immutable$
BEGIN
 RAISE EXCEPTION 'GPT02_REVIEW_INTENT_AUDIT_IMMUTABLE'
   USING ERRCODE='55000';
END;
$immutable$;
REVOKE ALL ON FUNCTION ai_platform.dev_gpt02_review_intent_immutable() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS dev_gpt02_review_intent_immutable_trg
  ON ai_platform.dev_gpt02_operator_review_intents;
CREATE TRIGGER dev_gpt02_review_intent_immutable_trg
  BEFORE UPDATE OR DELETE ON ai_platform.dev_gpt02_operator_review_intents
  FOR EACH ROW EXECUTE FUNCTION ai_platform.dev_gpt02_review_intent_immutable();
