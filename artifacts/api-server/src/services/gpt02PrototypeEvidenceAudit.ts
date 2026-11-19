/**
 * DEV-only server-verified prototype file integrity audit.
 * Validates actual file bytes; stores only a content digest and provenance.
 * Nothing in this service is a checkpoint, lease, grant, command or dispatch.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validateHumanRecoverySubject } from "./humanRecoveryDecisionService.js";
import { verifyGpt02PrototypeManifest } from "./gpt02PrototypeManifestIntegrity.js";

const MAX_PROTOTYPE_BYTES=1024*1024;
export const PROTOTYPE_AUDIT_ACTION="prototype_bytes_sha256_verified";

export function decodePrototypeBase64(raw:unknown):Buffer|null {
  if(typeof raw!=="string" || raw.length===0 ||
    raw.length>Math.ceil(MAX_PROTOTYPE_BYTES/3)*4+4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))
    return null;
  const bytes=Buffer.from(raw,"base64");
  if(!bytes.length || bytes.length>MAX_PROTOTYPE_BYTES || bytes.toString("base64")!==raw)
    return null;
  return bytes;
}

export function parsePrototypeAudit(
  raw:unknown, actor:unknown, assigned:unknown,
  commandId:string, jobId:number|null, humanReviewId:number|null,
):{verified:true;sha256:string;bytes:number}|null {
  if(typeof raw!=="string" || raw.length>2000 ||
    typeof actor!=="string" || typeof assigned!=="string" ||
    actor.toLowerCase().trim()!==assigned.toLowerCase().trim() ||
    !jobId || !humanReviewId) return null;
  try {
    const a:unknown=JSON.parse(raw);
    if(!a || typeof a!=="object" || Array.isArray(a))return null;
    const r=a as Record<string,unknown>;
    if(r["schemaVersion"]!==1 || r["evidenceKind"]!=="server_hashed_artifact_bytes" ||
      r["jobId"]!==jobId || r["commandId"]!==commandId || r["humanReviewId"]!==humanReviewId ||
      r["artifactStage"]!=="recovered_prototype_dev" ||
      r["operationalIntegrationVerified"]!==false || r["attestationVerified"]!==false ||
      r["resumeAuthorized"]!==false || r["mayCreateCommand"]!==false ||
      r["mayDispatchWorker"]!==false || r["mayCloseJob"]!==false ||
      typeof r["sha256"]!=="string" || !/^[a-f0-9]{64}$/.test(r["sha256"]) ||
      typeof r["bytes"]!=="number" || !Number.isInteger(r["bytes"]) ||
      r["bytes"]<1 || r["bytes"]>MAX_PROTOTYPE_BYTES)
      return null;
    return {verified:true,sha256:r["sha256"],bytes:r["bytes"]};
  }catch{return null;}
}

export async function recordGpt02PrototypeIntegrity(input:{
  humanReviewId:number; jobId:number;commandId:string;actor:string;
  manifest:unknown; artifactBase64:string;
}) {
  const bytes=decodePrototypeBase64(input.artifactBase64);
  if(!bytes)return {ok:false as const,error:"INVALID_OR_OVERSIZED_PROTOTYPE_BYTES"};
  const integrity=verifyGpt02PrototypeManifest(input.manifest,bytes,{
    humanReviewId:input.humanReviewId,jobId:input.jobId,commandId:input.commandId,
  });
  if(!integrity.artifactIntegrityVerified)
    return {ok:false as const,error:integrity.reason};
  const manifest=input.manifest as {sha256:string;bytes:number};
  return db.transaction(async tx=>{
    const locked=await tx.execute(sql`
      SELECT id,source_module,status,assigned_user,payload_json
      FROM ai_platform.ai_human_tasks WHERE id=${input.humanReviewId} FOR UPDATE
    `);
    const task=locked.rows?.[0];
    if(!task)return {ok:false as const,error:"HUMAN_REVIEW_NOT_FOUND"};
    const err=validateHumanRecoverySubject({
      sourceModule:task["source_module"],status:task["status"],
      assignedUser:task["assigned_user"],payload:task["payload_json"],
      actor:input.actor,jobId:input.jobId,commandId:input.commandId,
    });
    if(err)return {ok:false as const,error:err};
    const proof=await tx.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM ai_platform.ai_human_task_history h
        WHERE h.task_id=${input.humanReviewId}
          AND h.action='human_recovery_recommendation'
          AND h.performed_by=${input.actor}
          AND h.notes::jsonb->>'decision'='recommend_new_attempt'
          AND h.notes::jsonb->>'commandId'=${input.commandId}
          AND h.notes::jsonb->>'jobId'=${String(input.jobId)}
      ) AS recommended,
      EXISTS(
        SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
        WHERE c.id=${input.commandId}::uuid AND c.status='FAILED'
          AND c.metadata_json->>'devOnly'='true'
          AND c.metadata_json->>'capability'='chatgpt:wake'
      ) AS original_failed,
      (SELECT h.notes FROM ai_platform.ai_human_task_history h
       WHERE h.task_id=${input.humanReviewId}
         AND h.action=${PROTOTYPE_AUDIT_ACTION}
       ORDER BY h.id DESC LIMIT 1) AS previous_notes,
      (SELECT h.performed_by FROM ai_platform.ai_human_task_history h
       WHERE h.task_id=${input.humanReviewId}
         AND h.action=${PROTOTYPE_AUDIT_ACTION}
       ORDER BY h.id DESC LIMIT 1) AS previous_actor
    `);
    const row=proof.rows?.[0];
    if(row?.["recommended"]!==true)return {ok:false as const,error:"REVIEW_RECOMMENDATION_REQUIRED"};
    if(row?.["original_failed"]!==true)return {ok:false as const,error:"ORIGINAL_COMMAND_NOT_VERIFIED"};
    if(row?.["previous_notes"]!==null && row?.["previous_notes"]!==undefined){
      const p=parsePrototypeAudit(row["previous_notes"],row["previous_actor"],task["assigned_user"],
        input.commandId,input.jobId,input.humanReviewId);
      if(p && p.sha256===manifest.sha256 && p.bytes===manifest.bytes)
        return {ok:true as const,alreadyRecorded:true as const,sha256:p.sha256,bytes:p.bytes,
          operationalIntegrationVerified:false as const,mayCreateCommand:false as const,
          mayDispatchWorker:false as const,mayCloseJob:false as const};
      return {ok:false as const,error:"PROTOTYPE_EVIDENCE_ALREADY_RECORDED"};
    }
    const audit=JSON.stringify({
      schemaVersion:1,evidenceKind:"server_hashed_artifact_bytes",
      humanReviewId:input.humanReviewId,jobId:input.jobId,commandId:input.commandId,
      artifactStage:"recovered_prototype_dev",
      sha256:manifest.sha256,bytes:manifest.bytes,
      operationalIntegrationVerified:false,attestationVerified:false,
      resumeAuthorized:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
    });
    const saved=await tx.execute(sql`
      INSERT INTO ai_platform.ai_human_task_history
        (task_id,action,performed_by,notes,old_status,new_status)
      VALUES (${input.humanReviewId},${PROTOTYPE_AUDIT_ACTION},
        ${input.actor},${audit},'accepted','accepted')
      RETURNING id
    `);
    return {ok:true as const,alreadyRecorded:false as const,
      auditId:Number(saved.rows?.[0]?.["id"]),
      sha256:manifest.sha256,bytes:manifest.bytes,
      operationalIntegrationVerified:false as const,
      mayCreateCommand:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const};
  });
}
