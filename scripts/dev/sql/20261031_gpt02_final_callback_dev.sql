-- DEV ONLY: apply to Supabase project xssrfshdrtdfupgqwfdw after reviewing.
-- Never register this file as an automatic PROD migration.
-- Source of truth: live DEV trigger record_verified_gpt02_final_callback_dev
-- Records an already verified Ed25519 receipt; it never generates an ACK,
-- impersonates the assistant, or creates a signature.
BEGIN;
DO $dev_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_platform.ai_settings s
    WHERE s.key='dev.chatgpt_wake.account_bindings'
      AND s.category='guardrail' AND s.is_secret=false
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(s.value::jsonb->'bindings') b
        WHERE b->>'accountAlias'='GPT02'
          AND b->>'workerId'='openclaw-dell-chatgpt-wake-dev'
          AND b->>'browserProfile'='gpt02-dell-dev'
          AND b->>'enabled'='true')
  ) THEN
    RAISE EXCEPTION 'DEV GPT02 DELL binding not found: refuse migration';
  END IF;
  IF to_regclass('ai_platform.chatgpt_attestation_final_callbacks_dev') IS NULL THEN
    RAISE EXCEPTION 'DEV final callback table missing';
  END IF;
END
$dev_preflight$;
CREATE OR REPLACE FUNCTION ai_platform.record_verified_gpt02_final_callback_dev()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $record$
DECLARE
  cmd record;
  att jsonb;
BEGIN
  IF NEW.kind <> 'COMPLETED'
     OR NEW.metadata_json->>'verifiedAssistantReply' IS DISTINCT FROM 'true'
     OR NEW.metadata_json->>'e2eCode' IS DISTINCT FROM 'E2E_VERIFIED'
  THEN RETURN NEW; END IF;
  SELECT c.source,c.command_type,c.status,c.metadata_json
    INTO cmd FROM ai_platform.ai_coding_bridge_commands c
    WHERE c.id=NEW.command_id;
  IF NOT FOUND OR cmd.metadata_json->>'assignedClientId'
     IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev'
  THEN RETURN NEW; END IF;
  att := NEW.metadata_json->'attestation';
  IF cmd.source IS DISTINCT FROM 'ai-core'
     OR cmd.command_type IS DISTINCT FROM 'EXTERNAL_AGENT_WORK'
     OR cmd.status IS DISTINCT FROM 'COMPLETED'
     OR cmd.metadata_json->>'e2eCode' IS DISTINCT FROM 'E2E_VERIFIED'
     OR cmd.metadata_json->>'deliveryCode' IS DISTINCT FROM 'DELIVERY_CONFIRMED'
     OR cmd.metadata_json->>'capability' IS DISTINCT FROM 'chatgpt:wake'
     OR cmd.metadata_json->>'explicitWorkerTarget' IS DISTINCT FROM 'true'
     OR cmd.metadata_json#>>'{wakeBinding,accountAlias}' IS DISTINCT FROM 'GPT02'
     OR cmd.metadata_json#>>'{wakeBinding,workerId}' IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev'
     OR cmd.metadata_json#>>'{wakeBinding,browserProfile}' IS DISTINCT FROM 'gpt02-dell-dev'
     OR jsonb_typeof(att) IS DISTINCT FROM 'object'
     OR att->>'algorithm' IS DISTINCT FROM 'Ed25519'
     OR att->>'version' IS DISTINCT FROM '2'
     OR att->>'workerId' IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev'
     OR att->>'browserProfile' IS DISTINCT FROM 'gpt02-dell-dev'
     OR att->>'conversationId' IS DISTINCT FROM cmd.metadata_json->>'targetConversationId'
     OR att->>'eventId' IS DISTINCT FROM cmd.metadata_json->>'eventId'
     OR att->>'challenge' IS DISTINCT FROM cmd.metadata_json->>'assistantAttestationChallenge'
     OR att->>'bindingFingerprint' IS DISTINCT FROM cmd.metadata_json#>>'{wakeBinding,bindingFingerprint}'
     OR coalesce(att->>'eventId','') !~ '^[a-f0-9]{64}$'
     OR coalesce(att->>'challenge','') !~ '^[a-f0-9]{64}$'
     OR coalesce(att->>'assistantResponseHash','') !~ '^[a-f0-9]{64}$'
     OR coalesce(att->>'assistantMessageId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR length(coalesce(att->>'signature','')) <> 88
     OR length(coalesce(att->>'keyId','')) < 1
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='GPT02_FINAL_CALLBACK_PROOF_INCOMPLETE';
  END IF;
  INSERT INTO ai_platform.chatgpt_attestation_final_callbacks_dev
    (event_id,command_id,worker_id,conversation_id,challenge,
     key_id,assistant_message_id,response_hash,signature_b64,verified_at)
  VALUES
    (att->>'eventId', NEW.command_id, att->>'workerId',
     (att->>'conversationId')::uuid, att->>'challenge',
     att->>'keyId', (att->>'assistantMessageId')::uuid,
     att->>'assistantResponseHash',att->>'signature',NEW.created_at)
  ON CONFLICT (command_id) DO NOTHING;
  RETURN NEW;
END
$record$;
DROP TRIGGER IF EXISTS record_verified_gpt02_final_callback_dev
  ON ai_platform.ai_coding_bridge_responses;
CREATE TRIGGER record_verified_gpt02_final_callback_dev
AFTER INSERT ON ai_platform.ai_coding_bridge_responses
FOR EACH ROW
WHEN (NEW.kind='COMPLETED'
  AND NEW.metadata_json->>'verifiedAssistantReply'='true'
  AND NEW.metadata_json->>'e2eCode'='E2E_VERIFIED')
EXECUTE FUNCTION ai_platform.record_verified_gpt02_final_callback_dev();
COMMIT;
