/**
 * Evidence-only DEV cross-ledger census for one parent GPT02 command.
 * Searches only durable explicit IDs. Never certifies absence of untagged
 * historical work, nor emits command instructions/reviewer notes.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Input={humanReviewId:number;jobId:number;parentCommandId:string};
const deny=(reason:string)=>({
  valid:false as const,reason,
  legacyUntaggedAttemptsExcluded:false as const,
  mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
});
export function interpretGpt02CrossLedgerCounts(row: Record<string,unknown>|undefined) {
  if(!row)return deny("CROSS_LEDGER_SNAPSHOT_MISSING");
  if(row["subject_bound"]!==true)
    return deny(row["subject_bound"]===false?
      "CROSS_LEDGER_REVIEW_SUBJECT_NOT_BOUND":"CROSS_LEDGER_BINDING_UNVERIFIED");
  const keys=["parent_event_count","job_event_count","tagged_child_count","review_record_count"] as const;
  const values=keys.map(k=>row[k]);
  if(values.some(v=>typeof v!=="number"||!Number.isSafeInteger(v)||v<0))
    return deny("CROSS_LEDGER_SNAPSHOT_INVALID");
  return {
    valid:true as const,
    reason:"LEGACY_UNTAGGED_HISTORY_NOT_EXCLUDED" as const,
    parentEventCount:values[0] as number,
    explicitJobEventCount:values[1] as number,
    taggedChildCount:values[2] as number,
    reviewRecordCount:values[3] as number,
    legacyUntaggedAttemptsExcluded:false as const,
    mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
  };
}
export async function getGpt02Job135CrossLedgerReadback(x:Input) {
  if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]!=="development")
    return deny("DEV_ONLY");
  if(!Number.isSafeInteger(x.humanReviewId)||x.humanReviewId<1||
    !Number.isSafeInteger(x.jobId)||x.jobId<1||!uuid.test(x.parentCommandId))
    return deny("INVALID_CROSS_LEDGER_SUBJECT");
  let q: Awaited<ReturnType<typeof db.execute>>;
  try {
    q=await db.execute(sql`
    WITH bound AS (
      SELECT id FROM ai_platform.ai_human_tasks
      WHERE id=${x.humanReviewId}
        AND source_module='ai_core_lifecycle'
        AND payload_json->>'commandId'=${x.parentCommandId}
        AND payload_json->>'taskId'=${String(x.jobId)}
    )
    SELECT EXISTS(SELECT 1 FROM bound) AS subject_bound,
      (SELECT count(*)::integer FROM ai_platform.ai_events e
        WHERE EXISTS(SELECT 1 FROM bound)
         AND (e.correlation_id=${x.parentCommandId} OR
              e.causation_id=${x.parentCommandId} OR
              e.source_id=${x.parentCommandId} OR
              e.payload_json->>'commandId'=${x.parentCommandId} OR
              e.metadata_json->>'commandId'=${x.parentCommandId})
      ) AS parent_event_count,
      (SELECT count(*)::integer FROM ai_platform.ai_events e
        WHERE EXISTS(SELECT 1 FROM bound)
         AND (e.payload_json->>'jobId'=${String(x.jobId)} OR
              e.metadata_json->>'jobId'=${String(x.jobId)} OR
              e.payload_json->>'taskId'=${String(x.jobId)})
      ) AS job_event_count,
      (SELECT count(*)::integer FROM ai_platform.ai_coding_bridge_commands c
        WHERE EXISTS(SELECT 1 FROM bound)
         AND c.id<>${x.parentCommandId}::uuid
         AND (c.metadata_json->>'recoveryParentCommandId'=${x.parentCommandId} OR
              c.metadata_json->>'recovery_parent_command_id'=${x.parentCommandId} OR
              c.metadata_json->>'parentCommandId'=${x.parentCommandId})
      ) AS tagged_child_count,
      (SELECT count(*)::integer FROM ai_platform.ai_human_task_history h
        JOIN bound b ON b.id=h.task_id
        WHERE h.action IN ('human_recovery_recommendation',
          'prototype_bytes_sha256_verified')
      ) AS review_record_count
  `);
  } catch {
    // The primary timeline remains useful when the optional event census
    // cannot be read (permissions, migration drift or temporary DB failure).
    // Never convert missing evidence to four trustworthy zero counts.
    return deny("CROSS_LEDGER_READBACK_UNAVAILABLE");
  }
  return interpretGpt02CrossLedgerCounts(q.rows?.[0]);
}
