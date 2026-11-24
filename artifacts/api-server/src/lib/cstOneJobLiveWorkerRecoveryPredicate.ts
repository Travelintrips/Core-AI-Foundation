/**
 * CST-DEV pilot only: an old started_at is not evidence of a dead job.
 *
 * The exact pilot RUNNING job is protected from age-only recovery only while
 * its specific, dedicated remote worker still owns it with a fresh lease and
 * heartbeat. Stale/missing workers are NOT protected. Other job types and all
 * PROD deployments retain existing recovery behavior.
 *
 * Used in dispatcher and remote Ollama recovery to avoid two age-only paths.
 */
import { sql } from "drizzle-orm";

export function excludeHealthyCstDevPilotFromAgeOnlyRecovery(
  environment: {APP_ENV?:string;NODE_ENV?:string;CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED?:string},
) {
  if (environment.APP_ENV !== "development" ||
      environment.NODE_ENV !== "development" ||
      environment.CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED !== "true")
    return sql``;
  return sql`AND NOT (
    ai_platform.ai_jobs.job_type = 'ollama_model_invocation'
    AND ai_platform.ai_jobs.payload_json->>'requestId'
       ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
    AND EXISTS (
      SELECT 1 FROM ai_platform.ai_workers AS w
      WHERE w.id::text = ai_platform.ai_jobs.payload_json->>'_claimedByWorkerId'
        AND w.current_job = ai_platform.ai_jobs.id
        AND w.running_jobs > 0
        AND w.worker_name ~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'
        AND w.provider_slug = 'ollama'
        AND w.runtime_kind = 'ollama_remote_pull'
        AND w.model_id = 'qwen2.5:3b'
        AND w.lease_owner = 'ollama-remote:' || w.node_id
        AND w.status = 'busy'
        AND w.lease_expires_at > NOW()
        AND w.last_heartbeat > NOW() - INTERVAL '60 seconds'
    )
  )`;
}
