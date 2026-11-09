/**
 * Transaction-scoped DEV issuer preflight, intentionally read-only.
 * Lock the review, parent and candidate reservation in a fixed order so
 * decisions cannot be made from three unrelated HTTP snapshots.
 * No legal proof of untagged legacy absence exists yet: NEVER authorize.
 */
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {validateHumanRecoverySubject} from "./humanRecoveryDecisionService.js";
import {parseRecoveryRecommendation} from "./jobLifecycleRecoveryReview.js";
import {parsePrototypeAudit} from "./gpt02PrototypeEvidenceAudit.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Subject={jobId:number;humanReviewId:number;parentCommandId:string;
  reservationId:string;actor:string};
const deny=(reason:string,more:Record<string,unknown>={})=>({
  ok:false as const,reason,...more,
  issuerAuthorized:false as const, legacyUntaggedAttemptsExcluded:false as const,
  mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
});

export function validateGpt02IssuerPreflightInput(x:Subject) {
  if(!uuid.test(x.parentCommandId)||!uuid.test(x.reservationId))
    return "INVALID_COMMAND_IDENTITY";
  if(!Number.isSafeInteger(x.jobId)||x.jobId<=0||
     !Number.isSafeInteger(x.humanReviewId)||x.humanReviewId<=0||
     typeof x.actor!=="string"||x.actor.trim().length<1||x.actor.length>254)
    return "INVALID_REVIEW_SUBJECT";
  return null;
}

export async function readGpt02IssuerTransactionPreflight(input:Subject) {
  if(process.env["APP_ENV"]!=="development")
    return deny("NOT_DEV");
  const invalid=validateGpt02IssuerPreflightInput(input);
  if(invalid)return deny(invalid);
  return db.transaction(async tx=>{
    // Locks are acquired in a fixed order, and no command is issued.
    const task=await tx.execute(sql`
      SELECT id,source_module,source_id,status,assigned_user,payload_json
      FROM ai_platform.ai_human_tasks
      WHERE id=${input.humanReviewId} FOR UPDATE
    `);
    const review=task.rows?.[0];
    if(!review)return deny("HUMAN_REVIEW_NOT_FOUND");
    const subject=validateHumanRecoverySubject({
      sourceModule:review["source_module"],sourceId:review["source_id"],requireSourceId:true,status:review["status"],
      assignedUser:review["assigned_user"],payload:review["payload_json"],
      actor:input.actor,jobId:input.jobId,commandId:input.parentCommandId,
    });
    if(subject)return deny(subject);
    const parent=await tx.execute(sql`
      SELECT id,status,metadata_json
      FROM ai_platform.ai_coding_bridge_commands
      WHERE id=${input.parentCommandId}::uuid FOR UPDATE
    `);
    const cmd=parent.rows?.[0];
    const meta=cmd?.["metadata_json"];
    if(!cmd||cmd["status"]!=="FAILED"||!meta||
       typeof meta!=="object"||Array.isArray(meta)||
       (meta as Record<string,unknown>)["devOnly"]!==true||
       (meta as Record<string,unknown>)["capability"]!=="chatgpt:wake")
      return deny("FAILED_DEV_PARENT_REQUIRED");
    const reserved=await tx.execute(sql`
      SELECT id,parent_command_id,candidate_command_id,human_review_id,job_id,artifact_sha256
      FROM ai_platform.gpt02_dev_recovery_reservations
      WHERE id=${input.reservationId}::uuid FOR UPDATE
    `);
    const r=reserved.rows?.[0];
    if(!r||r["parent_command_id"]!==input.parentCommandId||
       Number(r["human_review_id"])!==input.humanReviewId||
       Number(r["job_id"])!==input.jobId||!uuid.test(String(r["candidate_command_id"])))
      return deny("RESERVATION_IDENTITY_MISMATCH");
    const proof=await tx.execute(sql`
      SELECT
        (SELECT h.notes FROM ai_platform.ai_human_task_history h
          WHERE h.task_id=${input.humanReviewId}
          AND h.action='human_recovery_recommendation'
          ORDER BY h.id DESC LIMIT 1) AS recommendation_notes,
        (SELECT h.performed_by FROM ai_platform.ai_human_task_history h
          WHERE h.task_id=${input.humanReviewId}
          AND h.action='human_recovery_recommendation'
          ORDER BY h.id DESC LIMIT 1) AS recommendation_actor,
        (SELECT h.notes FROM ai_platform.ai_human_task_history h
          WHERE h.task_id=${input.humanReviewId}
          AND h.action='prototype_bytes_sha256_verified'
          ORDER BY h.id DESC LIMIT 1) AS integrity_notes,
        (SELECT h.performed_by FROM ai_platform.ai_human_task_history h
          WHERE h.task_id=${input.humanReviewId}
          AND h.action='prototype_bytes_sha256_verified'
          ORDER BY h.id DESC LIMIT 1) AS integrity_actor
    `);
    const p=proof.rows?.[0];
    if(parseRecoveryRecommendation(p?.["recommendation_notes"],
      p?.["recommendation_actor"],review["assigned_user"],
      input.parentCommandId,input.jobId)!=="recommend_new_attempt")
      return deny("BOUND_REVIEWER_RECOMMENDATION_REQUIRED");
    const artifact=parsePrototypeAudit(p?.["integrity_notes"],
      p?.["integrity_actor"],review["assigned_user"],
      input.parentCommandId,input.jobId,input.humanReviewId);
    if(!artifact||artifact.sha256!==r["artifact_sha256"])
      return deny("ARTIFACT_BINDING_MISMATCH");
    const conflicts=await tx.execute(sql`
      SELECT
        EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_commands
          WHERE id=${String(r["candidate_command_id"])}::uuid) AS candidate_exists,
        EXISTS(SELECT 1 FROM ai_platform.gpt02_dev_recovery_command_links
          WHERE parent_command_id=${input.parentCommandId}::uuid
             OR reservation_id=${input.reservationId}::uuid) AS prior_link_exists,
        (SELECT COUNT(*)::integer FROM ai_platform.ai_coding_bridge_commands
          WHERE metadata_json->>'recoveryParentCommandId'=${input.parentCommandId}
             OR metadata_json->>'recovery_parent_command_id'=${input.parentCommandId}
             OR metadata_json->>'parentCommandId'=${input.parentCommandId})
          AS tagged_child_count
    `);
    const c=conflicts.rows?.[0];
    if(!c||typeof c["tagged_child_count"]!=="number")
      return deny("ATTEMPT_CENSUS_UNVERIFIED");
    if(c["candidate_exists"]!==false||c["prior_link_exists"]!==false||
       c["tagged_child_count"]!==0)
      return deny("KNOWN_ATTEMPT_CONFLICT");
    // Not enough: legacy untagged executions can be outside these tables.
    return deny("UNTAGGED_LEGACY_EXCLUSION_NOT_PROVEN",{
      preflightSnapshotBound:true,candidateCommandId:String(r["candidate_command_id"]),
      taggedChildCount:0,
    });
  });
}
