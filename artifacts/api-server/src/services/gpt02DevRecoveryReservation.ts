/**
 * DEV-only isolated reservation ledger. No coding command, lease, grant,
 * checkpoint or dispatch is issued. This service is intentionally NOT routed.
 * A future issuer must revalidate identity and authorization in its own
 * transaction; a reservation alone is NEVER authority to execute.
 */
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validateHumanRecoverySubject } from "./humanRecoveryDecisionService.js";
import { parseRecoveryRecommendation } from "./jobLifecycleRecoveryReview.js";
import { parsePrototypeAudit } from "./gpt02PrototypeEvidenceAudit.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=(error:string)=>({ok:false as const,error,
  mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const});

export function validateReservationRequest(input:{
  parentCommandId:string;humanReviewId:number;jobId:number;actor:string;idempotencyKey:string;
}) {
  if(!uuid.test(input.parentCommandId) || !uuid.test(input.idempotencyKey))
    return "INVALID_RESERVATION_IDENTITY";
  if(!Number.isSafeInteger(input.humanReviewId) || input.humanReviewId<=0 ||
     !Number.isSafeInteger(input.jobId) || input.jobId<=0 ||
     !input.actor.trim() || input.actor.length>254)
    return "INVALID_RESERVATION_SUBJECT";
  return null;
}

export async function reserveGpt02DevRecoveryAttempt(input:{
  parentCommandId:string;humanReviewId:number;jobId:number;actor:string;idempotencyKey:string;
}) {
  // Fail closed; default OFF, even when this module is deployed.
  if(process.env["APP_ENV"]==="production" ||
     process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]!=="true")
    return deny("RESERVATION_FEATURE_DISABLED");
  const invalid=validateReservationRequest(input);
  if(invalid)return deny(invalid);
  return db.transaction(async(tx)=>{
    // Serialize all requests against the same reviewer row. The DB also
    // enforces one reservation per parent and idempotency key.
    const locked=await tx.execute(sql`
      SELECT id,source_module,status,assigned_user,payload_json
      FROM ai_platform.ai_human_tasks
      WHERE id=${input.humanReviewId} FOR UPDATE
    `);
    const reviewer=locked.rows?.[0];
    if(!reviewer)return deny("HUMAN_REVIEW_NOT_FOUND");
    const err=validateHumanRecoverySubject({
      sourceModule:reviewer["source_module"],status:reviewer["status"],
      assignedUser:reviewer["assigned_user"],payload:reviewer["payload_json"],
      actor:input.actor,jobId:input.jobId,commandId:input.parentCommandId,
    });
    if(err)return deny(err);
    const original=await tx.execute(sql`
      SELECT status,metadata_json
      FROM ai_platform.ai_coding_bridge_commands
      WHERE id=${input.parentCommandId}::uuid FOR UPDATE
    `);
    const command=original.rows?.[0];
    const metadata=command?.["metadata_json"] as Record<string,unknown>|undefined;
    if(!command || command["status"]!=="FAILED" ||
      metadata?.["devOnly"]!==true || metadata?.["capability"]!=="chatgpt:wake")
      return deny("ORIGINAL_FAILED_DEV_COMMAND_REQUIRED");
    const evidence=await tx.execute(sql`
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
    const proof=evidence.rows?.[0];
    if(parseRecoveryRecommendation(proof?.["recommendation_notes"],
       proof?.["recommendation_actor"],reviewer["assigned_user"],
       input.parentCommandId,input.jobId)!=="recommend_new_attempt")
       return deny("BOUND_REVIEWER_RECOMMENDATION_REQUIRED");
    const artifact=parsePrototypeAudit(proof?.["integrity_notes"],
      proof?.["integrity_actor"],reviewer["assigned_user"],
      input.parentCommandId,input.jobId,input.humanReviewId);
    if(!artifact)return deny("SERVER_HASHED_PROTOTYPE_EVIDENCE_REQUIRED");
    const prior=await tx.execute(sql`
      SELECT id,parent_command_id,candidate_command_id,idempotency_key,
        human_review_id,job_id,artifact_sha256
      FROM ai_platform.gpt02_dev_recovery_reservations
      WHERE parent_command_id=${input.parentCommandId}::uuid
      FOR UPDATE
    `);
    const previous=prior.rows?.[0];
    if(previous){
      if(previous["idempotency_key"]!==input.idempotencyKey ||
        Number(previous["human_review_id"])!==input.humanReviewId ||
        Number(previous["job_id"])!==input.jobId ||
        previous["artifact_sha256"]!==artifact.sha256)
        return deny("PARENT_ALREADY_RESERVED");
      return {ok:true as const,alreadyReserved:true as const,
        reservationId:String(previous["id"]),
        candidateCommandId:String(previous["candidate_command_id"]),
        artifactSha256:artifact.sha256,
        mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const};
    }
    // Existing legacy/untagged children cannot be ruled out by this query.
    // A later issuer must use a durable parent relation and recheck at commit.
    const children=await tx.execute(sql`
      SELECT COUNT(*)::integer AS tagged_child_count
      FROM ai_platform.ai_coding_bridge_commands
      WHERE metadata_json->>'recoveryParentCommandId'=${input.parentCommandId}
         OR metadata_json->>'recovery_parent_command_id'=${input.parentCommandId}
         OR metadata_json->>'parentCommandId'=${input.parentCommandId}
    `);
    if(children.rows?.[0]?.["tagged_child_count"]!==0)
      return deny("EXISTING_OR_UNVERIFIED_CHILD_ATTEMPTS");
    const candidateCommandId=randomUUID();
    const inserted=await tx.execute(sql`
      INSERT INTO ai_platform.gpt02_dev_recovery_reservations
        (parent_command_id,candidate_command_id,human_review_id,
         job_id,idempotency_key,artifact_sha256)
      VALUES (${input.parentCommandId}::uuid,${candidateCommandId}::uuid,
        ${input.humanReviewId},${input.jobId},
        ${input.idempotencyKey}::uuid,${artifact.sha256})
      ON CONFLICT DO NOTHING
      RETURNING id,candidate_command_id
    `);
    if(!inserted.rows?.[0])return deny("RESERVATION_CONFLICT_RETRY_READBACK");
    return {
      ok:true as const,alreadyReserved:false as const,
      reservationId:String(inserted.rows[0]["id"]),
      candidateCommandId:String(inserted.rows[0]["candidate_command_id"]),
      artifactSha256:artifact.sha256,
      mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const,
    };
  });
}
