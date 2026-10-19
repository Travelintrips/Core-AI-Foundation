-- DEV ONLY: central non-secret configuration for GPT01 browser wake.
-- Runtime consumers remain constrained by trusted DEV host checks, durable
-- MCP_ACK_VERIFIED evidence, exact conversation/worker binding and Ed25519 verification.
-- PROD is intentionally out of scope.

BEGIN;

INSERT INTO ai_platform.ai_settings
  (key, value, value_type, category, description, is_secret)
VALUES
  ('dev.chatgpt_wake.enabled', 'true', 'boolean', 'guardrail',
   'Enable verified GPT01 browser wake on trusted DEV hosts only.', false),
  ('dev.chatgpt_wake.owner_channel',
   'ai-engine-oauth:84e4810f3b3b392675d0fd655ea01c3ee82c9160616adc35c1dfe06ac1568a67',
   'string', 'guardrail',
   'Verified AI Engine OAuth owner channel for GPT01 DEV wake.', false),
  ('dev.chatgpt_wake.gpt01_conversation_id',
   '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae',
   'string', 'guardrail',
   'Verified ChatGPT conversation bound to GPT01 DEV.', false),
  ('dev.chatgpt_wake.worker_id',
   'openclaw-dell-chatgpt-wake-dev',
   'string', 'guardrail',
   'Dedicated verified DELL wake worker for GPT01 DEV.', false),
  ('dev.chatgpt_wake.dell_attestation_public_key_der_b64',
   'MCowBQYDK2VwAyEA+QwGx3oBARMjbE9IaC2LTdYoq2jp+26DrOoeyNZm2mw=',
   'string', 'guardrail',
   'Public Ed25519 SPKI key for verifying DELL assistant attestations.', false)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  value_type = EXCLUDED.value_type,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  is_secret = false,
  updated_at = NOW();

COMMIT;
