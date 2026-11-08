/**
 * DEV read-only identity preview for a future *new* GPT02 attempt.
 *
 * A fresh UUID is advisory, not a reserved command, lease, signed grant,
 * retry clearance, worker dispatch, or a stable idempotency key.
 * The eventual issuer MUST recheck inside an exclusive DB transaction.
 */
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export function evaluateIdentityPreview(input:{
  parentCommandId:string;candidateCommandId:string;
  originalExists:boolean;originalStatus:string|null;
  candidateExists:boolean;taggedChildCount:number;
}) {
  const validUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  let reason="SNAPSHOT_CLEAR_NOT_RESERVED";
  if(!validUuid.test(input.parentCommandId) || !validUuid.test(input.candidateCommandId))
    reason="INVALID_IDENTITY";
  else if(!input.originalExists)reason="ORIGINAL_NOT_FOUND";
  else if(input.originalStatus!=="FAILED")reason="ORIGINAL_NOT_FAILED";
  else if(input.parentCommandId.toLowerCase()===input.candidateCommandId.toLowerCase())
    reason="COMMAND_REPLAY";
  else if(input.candidateExists)reason="CANDIDATE_ALREADY_EXISTS";
  else if(!Number.isSafeInteger(input.taggedChildCount)||input.taggedChildCount<0)
    reason="ATTEMPT_COUNT_UNVERIFIED";
  else if(input.taggedChildCount>0)reason="POSSIBLE_PRIOR_ATTEMPT";
  return {
    previewOnly:true as const,
    reason,
    candidateCommandId:input.candidateCommandId,
    observedTaggedChildCount:input.taggedChildCount,
    observedCandidateExists:input.candidateExists,
    identitySnapshotClear:reason==="SNAPSHOT_CLEAR_NOT_RESERVED",
    reservationVerified:false as const,
    duplicateFreeAtCommitVerified:false as const,
    exclusiveLeaseVerified:false as const,
    dispatchAuthorizationVerified:false as const,
    mayCreateCommand:false as const,
    mayDispatchWorker:false as const,
    mayCloseJob:false as const,
  };
}

export async function getNewAttemptIdentityPreview(parentCommandId:string) {
  // Never insert or reserve a new UUID here.
  const candidateCommandId=randomUUID();
  const rows=await db.execute(sql`
    SELECT
      EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_commands
        WHERE id=${parentCommandId}::uuid) AS original_exists,
      (SELECT status FROM ai_platform.ai_coding_bridge_commands
        WHERE id=${parentCommandId}::uuid LIMIT 1) AS original_status,
      EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_commands
        WHERE id=${candidateCommandId}::uuid) AS candidate_exists,
      (SELECT COUNT(*)::integer FROM ai_platform.ai_coding_bridge_commands
        WHERE metadata_json->>'recoveryParentCommandId'=${parentCommandId}
          OR metadata_json->>'recovery_parent_command_id'=${parentCommandId}
          OR metadata_json->>'parentCommandId'=${parentCommandId}) AS tagged_child_count
  `);
  const x=rows.rows?.[0];
  // A query failure does not silently imply there are no duplicates.
  const count=typeof x?.["tagged_child_count"]==="number"
    ? x["tagged_child_count"]:-1;
  return evaluateIdentityPreview({
    parentCommandId,candidateCommandId,
    originalExists:x?.["original_exists"]===true,
    originalStatus:typeof x?.["original_status"]==="string"?x["original_status"]:null,
    candidateExists:x?.["candidate_exists"]!==false,
    taggedChildCount:count,
  });
}
