/** Producer prefilter only. Hub still independently authorizes and verifies
 * every ledger registration and ACK. No worker, dispatch or source mutation. */
export type LedgerReconciliationScope =
  | { mode: "legacy" }
  | { mode: "blocked" }
  | { mode: "dev-passive-ping"; since: Date };

const project = "xssrfshdrtdfupgqwfdw";
const devUrl = "https://dev-ai-task.cstlogistic.co.id";
const floor = Date.parse("2026-11-27T17:54:15.000Z");

export function resolveLedgerReconciliationScope(
  env: NodeJS.ProcessEnv = process.env,
): LedgerReconciliationScope {
  const raw = env["AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE"];
  // No change to existing deployments unless an explicit new opt-in is set.
  if (raw === undefined) return { mode: "legacy" };
  const blocked = { mode: "blocked" } as const;
  if (env["NODE_ENV"] !== "development" || env["APP_ENV"] !== "development" ||
      env["AI_TASK_LEDGER_URL"] !== devUrl ||
      env["AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID"] ||
      (env["SUPABASE_URL_DEV"] || env["VITE_SUPABASE_URL_DEV"]) !== "https://" + project + ".supabase.co" ||
      (env["SUPABASE_URL_DEV"] && env["VITE_SUPABASE_URL_DEV"] &&
       env["SUPABASE_URL_DEV"] !== env["VITE_SUPABASE_URL_DEV"]) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return blocked;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || ms < floor || new Date(ms).toISOString() !== raw) return blocked;
  // Match the existing database resolver's DEV precedence; never inspect,
  // return or log credential values. Ambiguous alternate DEV URLs fail closed.
  const dbUrl = env["SUPABASE_DEV_DATABASE_URL"] || env["SUPABASE_DATABASE_URL_DEV"];
  if (!dbUrl || (env["SUPABASE_DEV_DATABASE_URL"] && env["SUPABASE_DATABASE_URL_DEV"] &&
      env["SUPABASE_DEV_DATABASE_URL"] !== env["SUPABASE_DATABASE_URL_DEV"])) return blocked;
  try {
    const u = new URL(dbUrl);
    const user = decodeURIComponent(u.username);
    const direct = u.hostname === "db." + project + ".supabase.co";
    const pooler = u.hostname.endsWith(".pooler.supabase.com") &&
      /^[a-zA-Z0-9_][a-zA-Z0-9_-]*\.[a-z0-9-]+$/.test(user) && user.endsWith("." + project);
    if (!["postgres:", "postgresql:"].includes(u.protocol) || !(direct || pooler)) return blocked;
  } catch { return blocked; }
  return { mode: "dev-passive-ping", since: new Date(ms) };
}

export function prospectiveLedgerSince(scope: Extract<LedgerReconciliationScope,{mode:"dev-passive-ping"}>, lookback: Date): Date {
  return new Date(Math.max(scope.since.getTime(), lookback.getTime()));
}

/** Exact positive source shape from Hub PR254's receiver evidence contract.
 * No dependency on Hub ledger tables: the receiver retains all registry
 * conflict/idempotency/lease/ACK checks. Only three harmless fields returned. */
export const DEV_PASSIVE_PING_SOURCE_SQL = `SELECT c.id, c.created_at, c.updated_at
FROM ai_platform.ai_coding_bridge_commands c
 WHERE c.source='ai-task-hub'
   AND c.command_type='EXTERNAL_AGENT_WORK' AND c.task_id IS NULL
   AND c.created_at >= $1::timestamptz
   AND c.instruction='ping' AND c.status='COMPLETED'
   AND c.metadata_json->>'environment'='development'
   AND c.metadata_json->>'productionAllowed'='false'
   AND c.metadata_json->>'origin'='ai-task-hub'
   AND c.metadata_json->>'executionBoundary'='role-scoped'
   AND c.metadata_json->>'requiredCapability'='tools:bounded'
   AND c.metadata_json->>'criticalActionsRequireAiCoreApproval'='true'
   AND c.metadata_json->>'explicitWorkerTarget'='true'
   AND c.metadata_json->>'assignedClientId'='openclaw-pc-worker-dev'
   AND c.metadata_json->>'claimedBy'='openclaw-pc-worker-dev'
   AND c.metadata_json->>'completedBy'='openclaw-pc-worker-dev'
   AND c.metadata_json->>'statusCode'='JOB_COMPLETED'
   AND c.metadata_json->>'deliveryCode'='UNKNOWN_UNVERIFIED'
   AND c.metadata_json->>'e2eCode'='UNKNOWN_UNVERIFIED'
   AND NOT (c.metadata_json ?| array['executionJobId','wakeBinding','assistantAttestationChallenge','gpt02TaskId','accountAlias','browserProfile'])
   AND COALESCE(c.metadata_json->>'capability','')<>'chatgpt:wake'
   AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(c.metadata_json)='object' THEN c.metadata_json ELSE '{}'::jsonb END) AS k(key)
     WHERE k.key NOT IN ('assignedClientId','claimedAt','claimedBy','coldStart','completedAt','completedBy',
       'criticalActionsRequireAiCoreApproval','deliveryCode','e2eCode','environment','executionBoundary',
       'explicitWorkerTarget','operationalSop','operationalSopSource','origin','productionAllowed',
       'requestedAt','requiredCapability','statusCode','syntheticAudit','auditPurpose'))
   AND (SELECT count(*) FROM ai_platform.ai_coding_bridge_responses r
        WHERE r.command_id=c.id AND r.kind IN ('COMPLETED','FAILED'))=1
   AND EXISTS (SELECT 1 FROM ai_platform.ai_coding_bridge_responses r
     WHERE r.command_id=c.id AND r.task_id IS NULL AND r.kind='COMPLETED'
       AND r.message='pong from DELL' AND r.acknowledged_at IS NOT NULL
       AND r.metadata_json->>'mode'='ping' AND r.metadata_json->>'runtime'='openclaw-pc2'
       AND r.checkpoint_json->>'clientId'='openclaw-pc-worker-dev'
       AND r.metadata_json->>'statusCode'='JOB_COMPLETED'
       AND r.metadata_json->>'deliveryCode'='UNKNOWN_UNVERIFIED'
       AND r.metadata_json->>'e2eCode'='UNKNOWN_UNVERIFIED')
ORDER BY c.created_at DESC, c.id DESC LIMIT $2 OFFSET $3`;
