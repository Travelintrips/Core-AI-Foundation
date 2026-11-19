-- DEV only: exclude legacy duplicate incidents; protect new GPT02 jobs across workers and conversations.
-- The complete parent correlation ID is the canonical idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_gpt02_ai_task_parent_dispatch_v1
ON ai_platform.ai_coding_bridge_commands ((metadata_json->>'correlationId'))
WHERE created_at >= TIMESTAMPTZ '2026-10-30 12:18:10+00'
  AND source = 'ai-core'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND metadata_json->>'correlationId' LIKE 'ai-task:%'
  AND metadata_json->'wakeBinding'->>'accountAlias' = 'GPT02';
