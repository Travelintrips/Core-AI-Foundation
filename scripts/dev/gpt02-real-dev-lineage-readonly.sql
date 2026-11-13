-- GPT02 DEV observability: read-only evidence inventory; never authorizes dispatch.
-- Verified against CST-DEV schema on 2026-11-09. No raw instructions, tokens,
-- customer data, proof payloads or credentials are selected.
-- This is a single database snapshot, not independent cryptographic attestation
-- and not proof of a separately deployed Task Center service.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
WITH pairs AS MATERIALIZED (
  SELECT c.id, c.status AS core_status, c.task_id AS core_task_id,
         j.id AS receiver_job_id, j.status AS hub_status,
         j.progress, j.task_id AS hub_task_id,
         j.command_id AS hub_command_id, j.correlation_id AS hub_correlation_id,
         j.callback_verified, j.attestation_verified, j.final_ack_verified,
         t.id AS linked_task_id, t.assigned_to_id,
         c.metadata_json, j.metadata
  FROM ai_platform.ai_coding_bridge_commands c
  JOIN public.ai_execution_jobs j ON j.external_id='bridge-command:'||c.id::text
  LEFT JOIN public.ai_tasks t ON t.id=j.task_id
  ORDER BY c.created_at DESC
  LIMIT 20
)
SELECT id::text AS core_command_id,receiver_job_id::text,
       core_status,hub_status,progress,
       core_task_id IS NOT NULL AS core_task_present,
       hub_task_id IS NOT NULL AS hub_task_present,
       linked_task_id IS NOT NULL AS hub_task_record_present,
       assigned_to_id IS NOT NULL AS assignee_present,
       COALESCE(hub_command_id=id,false) AS explicit_command_link_matches,
       COALESCE(hub_correlation_id=id,false) AS correlation_link_matches,
       COALESCE(callback_verified,false) AS callback_verified,
       COALESCE(attestation_verified,false) AS attestation_verified,
       COALESCE(final_ack_verified,false) AS final_ack_verified,
       (metadata_json ? 'aiTaskId') AS source_metadata_has_task_hint,
       (metadata ? 'jobId') AS hub_metadata_has_job_hint,
       CASE
         WHEN upper(core_status)='FAILED' THEN 'FAILED_NEVER_COMPLETE_FROM_PROGRESS'
         WHEN core_task_id IS NULL OR hub_task_id IS NULL THEN 'MISSING_TASK_LINEAGE'
         WHEN linked_task_id IS NULL OR assigned_to_id IS NULL THEN 'MISSING_OWNER_OR_ASSIGNMENT'
         WHEN NOT COALESCE(final_ack_verified,false) THEN 'NATIVE_FINAL_ACK_UNVERIFIED'
         ELSE 'REQUIRES_INDEPENDENT_LIVE_ATTESTATION'
       END AS diagnostic_only
FROM pairs
ORDER BY core_command_id;
ROLLBACK;
