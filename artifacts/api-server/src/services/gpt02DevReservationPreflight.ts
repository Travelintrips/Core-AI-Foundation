/**
 * DEV-only read-only evidence summary for reserving a candidate command.
 * This is a point-in-time snapshot, not authorization or an execution lease.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validateHumanRecoverySubject } from "./humanRecoveryDecisionService.js";
import { parseRecoveryRecommendation } from "./jobLifecycleRecoveryReview.js";
import { parsePrototypeAudit } from "./gpt02PrototypeEvidenceAudit.js";


type Request = {
  parentCommandId:string;humanReviewId:number;jobId:number;actor:string;
};

export function assessDevReservationSnapshot(input:Request, row:Record<string,unknown>|undefined) {
  let reason="SNAPSHOT_ONLY_NO_RESERVATION";
  const mismatch=validateHumanRecoverySubject({
    sourceModule:row?.["source_module"],status:row?.["review_status"],
    assignedUser:row?.["assigned_user"],payload:row?.["payload_json"],
    commandId:input.parentCommandId,jobId:input.jobId,actor:input.actor,
  });
  if(!row || row["review_id"]==null)reason="HUMAN_REVIEW_NOT_FOUND";
  else if(mismatch)reason=mismatch;
  else if(row["command_status"]!=="FAILED" ||
    row["command_dev_only"]!=="true" ||
    row["command_capability"]!=="chatgpt:wake")
    reason="ORIGINAL_FAILED_DEV_COMMAND_REQUIRED";
  else if(parseRecoveryRecommendation(row["recommendation_notes"],
      row["recommendation_actor"],row["assigned_user"],
      input.parentCommandId,input.jobId)!=="recommend_new_attempt")
    reason="BOUND_REVIEWER_RECOMMENDATION_REQUIRED";
  else if(!parsePrototypeAudit(row["integrity_notes"],
      row["integrity_actor"],row["assigned_user"],
      input.parentCommandId,input.jobId,input.humanReviewId))
    reason="SERVER_HASHED_PROTOTYPE_EVIDENCE_REQUIRED";
  else if(row["reservation_id"]!=null)reason="PARENT_ALREADY_RESERVED";
  else if(typeof row["tagged_child_count"]!=="number" ||
    !Number.isSafeInteger(row["tagged_child_count"]) || row["tagged_child_count"]<0)
    reason="CHILD_ATTEMPT_COUNT_UNVERIFIED";
  else if(row["tagged_child_count"]!==0)
    reason="EXISTING_CHILD_ATTEMPT_TAGS";
  return {
    previewOnly:true as const,
    reason,
    // No transaction-level exclusion of legacy untagged attempts is possible
    // with this snapshot. The eventual issuer must revalidate under lock.
    prerequisiteSnapshotClear:reason==="SNAPSHOT_ONLY_NO_RESERVATION",
    currentReservationPresent:row?.["reservation_id"]!=null,
    existingTaggedChildren:typeof row?.["tagged_child_count"]==="number"
      ?row["tagged_child_count"]:null,
    featureEnabled:process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]==="true" &&
      process.env["APP_ENV"]!=="production",
    legacyUntaggedAttemptsExcluded:false as const,
    transactionExclusivityVerified:false as const,
    reservationCreated:false as const,
    commandCreated:false as const,
    executionLeaseVerified:false as const,
    mayCreateCommand:false as const,
    mayDispatchWorker:false as const,
    mayCloseJob:false as const,
  };
}

export async function getGpt02DevReservationPreflight(input:Request){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.parentCommandId))
    return {ok:false as const,error:"INVALID_RESERVATION_IDENTITY"};
  if(!Number.isSafeInteger(input.humanReviewId)||input.humanReviewId<1 ||
     !Number.isSafeInteger(input.jobId)||input.jobId<1 ||
     !input.actor.trim()||input.actor.length>254)
    return {ok:false as const,error:"INVALID_RESERVATION_SUBJECT"};
  const query=await db.execute(sql`
    SELECT t.id AS review_id, t.source_module,t.status AS review_status,
      t.assigned_user,t.payload_json,
      c.status AS command_status,
      c.metadata_json->>'devOnly' AS command_dev_only,
      c.metadata_json->>'capability' AS command_capability,
      (SELECT h.notes FROM ai_platform.ai_human_task_history h
        WHERE h.task_id=t.id AND h.action='human_recovery_recommendation'
        ORDER BY h.id DESC LIMIT 1) AS recommendation_notes,
      (SELECT h.performed_by FROM ai_platform.ai_human_task_history h
        WHERE h.task_id=t.id AND h.action='human_recovery_recommendation'
        ORDER BY h.id DESC LIMIT 1) AS recommendation_actor,
      (SELECT h.notes FROM ai_platform.ai_human_task_history h
        WHERE h.task_id=t.id AND h.action='prototype_bytes_sha256_verified'
        ORDER BY h.id DESC LIMIT 1) AS integrity_notes,
      (SELECT h.performed_by FROM ai_platform.ai_human_task_history h
        WHERE h.task_id=t.id AND h.action='prototype_bytes_sha256_verified'
        ORDER BY h.id DESC LIMIT 1) AS integrity_actor,
      (SELECT r.id FROM ai_platform.gpt02_dev_recovery_reservations r
        WHERE r.parent_command_id=${input.parentCommandId}::uuid) AS reservation_id,
      (SELECT COUNT(*)::integer FROM ai_platform.ai_coding_bridge_commands child
        WHERE child.metadata_json->>'recoveryParentCommandId'=${input.parentCommandId}
           OR child.metadata_json->>'recovery_parent_command_id'=${input.parentCommandId}
           OR child.metadata_json->>'parentCommandId'=${input.parentCommandId})
        AS tagged_child_count
    FROM ai_platform.ai_human_tasks t
    LEFT JOIN ai_platform.ai_coding_bridge_commands c
      ON c.id=${input.parentCommandId}::uuid
    WHERE t.id=${input.humanReviewId}
    LIMIT 1
  `);
  return {ok:true as const,
    ...assessDevReservationSnapshot(input,query.rows?.[0])};
}
