/**
 * DEV-only legacy command census. Read-only diagnostic evidence, never a
 * proof of absence of untagged attempts and never issuer authorization.
 * Legacy command records may predate durable ancestry.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CommandObservation = {
  commandId: string;
  hasExplicitParentTag: boolean;
  hasDurableLink: boolean;
  sameJobEvidence: boolean;
  temporalOverlap: boolean;
};
export function assessGpt02LegacyAttemptCensus(input: {
  parentCommandId: string;
  scannedCommandCount: number;
  totalCommandCount: number;
  observations: readonly CommandObservation[];
}) {
  const deny = (reason: string, suspectedCommandIds: readonly string[] = []) => ({
    reviewOnly: true as const,
    reason,
    suspectedCommandIds,
    legacyUntaggedAttemptsExcluded: false as const,
    mayCreateCommand: false as const,
    mayDispatchWorker: false as const,
    mayCloseJob: false as const,
  });
  if (!uuid.test(input.parentCommandId)) return deny("INVALID_PARENT_COMMAND");
  if (!Number.isSafeInteger(input.scannedCommandCount) ||
      !Number.isSafeInteger(input.totalCommandCount) ||
      input.scannedCommandCount < 0 || input.totalCommandCount < 0 ||
      input.scannedCommandCount > input.totalCommandCount ||
      input.scannedCommandCount !== input.observations.length) {
    return deny("INCOMPLETE_COMMAND_CENSUS");
  }
  const seen = new Set<string>();
  for (const observation of input.observations) {
    if (!uuid.test(observation.commandId) ||
        observation.commandId.toLowerCase() === input.parentCommandId.toLowerCase() ||
        seen.has(observation.commandId.toLowerCase())) {
      return deny("AMBIGUOUS_COMMAND_IDENTITY");
    }
    seen.add(observation.commandId.toLowerCase());
  }
  const suspected = input.observations
    .filter(x => x.hasExplicitParentTag || x.hasDurableLink ||
      x.sameJobEvidence || x.temporalOverlap)
    .map(x => x.commandId);
  if (suspected.length > 0) return deny("POSSIBLE_LEGACY_CHILD_ATTEMPTS", suspected);
  if (input.scannedCommandCount !== input.totalCommandCount)
    return deny("INCOMPLETE_COMMAND_CENSUS");
  // Even a complete query against the bridge table is NOT exhaustive proof:
  // historical work may have existed in other ledgers without parent tags.
  return deny("UNLINKED_LEGACY_HISTORY_NOT_EXCLUDED");
}

export async function readGpt02LegacyAttemptCensus(input: {
  parentCommandId: string;
}) {
  if (process.env["APP_ENV"] !== "development")
    return {reviewOnly: true as const,reason:"NOT_DEV",
      legacyUntaggedAttemptsExcluded:false as const,
      mayCreateCommand:false as const,mayDispatchWorker:false as const,
      mayCloseJob:false as const};
  if (!uuid.test(input.parentCommandId)) return assessGpt02LegacyAttemptCensus({
    parentCommandId:input.parentCommandId,scannedCommandCount:0,totalCommandCount:0,observations:[],
  });
  // Only a diagnostic count; do not pull sensitive instructions or metadata.
  const result = await db.execute(sql`
    WITH parent AS (
      SELECT id, created_at, metadata_json
      FROM ai_platform.ai_coding_bridge_commands
      WHERE id=${input.parentCommandId}::uuid
    ), eligible AS (
      SELECT c.id, c.metadata_json, c.created_at
      FROM ai_platform.ai_coding_bridge_commands c
      CROSS JOIN parent p
      WHERE c.id<>p.id AND c.created_at>=p.created_at
        AND c.source IN ('ai-core','chatgpt')
    )
    SELECT
      COUNT(c.id)::integer AS total_count,
      COUNT(c.id) FILTER (WHERE
        c.metadata_json->>'recoveryParentCommandId'=${input.parentCommandId} OR
        c.metadata_json->>'recovery_parent_command_id'=${input.parentCommandId} OR
        c.metadata_json->>'parentCommandId'=${input.parentCommandId}
      )::integer AS tagged_count,
      COUNT(c.id) FILTER (WHERE
        c.metadata_json->>'jobId' = p.metadata_json->>'jobId'
        AND p.metadata_json ? 'jobId'
      )::integer AS same_job_count,
      COUNT(c.id) FILTER (WHERE
        c.created_at >= p.created_at
      )::integer AS overlapping_count
    FROM parent p LEFT JOIN eligible c ON TRUE
    GROUP BY p.id
  `);
  const row = result.rows?.[0];
  if (!row) return {reviewOnly:true as const,reason:"PARENT_COMMAND_NOT_FOUND",
    legacyUntaggedAttemptsExcluded:false as const,
    mayCreateCommand:false as const,mayDispatchWorker:false as const,
    mayCloseJob:false as const};
  const counts = ["total_count","tagged_count","same_job_count","overlapping_count"]
    .map(k=>Number(row[k]));
  if (counts.some(x=>!Number.isSafeInteger(x)||x<0))
    return {reviewOnly:true as const,reason:"INCOMPLETE_COMMAND_CENSUS",
      legacyUntaggedAttemptsExcluded:false as const,
      mayCreateCommand:false as const,mayDispatchWorker:false as const,
      mayCloseJob:false as const};
  return {
    reviewOnly:true as const,
    reason:counts[1]!>0 || counts[2]!>0 || counts[3]!>0
      ? "POSSIBLE_LEGACY_CHILD_ATTEMPTS" : "UNLINKED_LEGACY_HISTORY_NOT_EXCLUDED",
    recentBridgeCount:counts[0],
    taggedCount:counts[1],
    sameJobCount:counts[2],
    overlappingCount:counts[3],
    legacyUntaggedAttemptsExcluded:false as const,
    mayCreateCommand:false as const,
    mayDispatchWorker:false as const,
    mayCloseJob:false as const,
  };
}
