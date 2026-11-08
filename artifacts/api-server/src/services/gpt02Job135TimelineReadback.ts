/**
 * Server-owned DEV read-only timeline from bridge tables.
 * All evidence labels originate from database rows and independent verifier;
 * a worker-provided metadata JSON flag can NEVER certify terminal completion.
 * This service neither grants execution nor sends a notification.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCodingCommandLifecycleEvidence } from "./codingCommandLifecycleEvidence.js";
import {projectGpt02Job135Timeline,type TimelineResponse} from "./gpt02Job135TimelineProjection.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = new Set(["ACK","PROGRESS","CHECKPOINT","BLOCKER","COMPLETED","FAILED"]);
type Input = {humanReviewId:number;jobId:number;parentCommandId:string};
const denied = (reason:string)=>({
  ok:false as const,reason,mayDispatchWorker:false as const,mayCloseJob:false as const,
});

export function validateGpt02TimelineReadbackInput(x:Input) {
  if (!Number.isSafeInteger(x.humanReviewId)||x.humanReviewId<1||
    !Number.isSafeInteger(x.jobId)||x.jobId<1||
    !uuid.test(x.parentCommandId)) return "INVALID_TIMELINE_SUBJECT";
  return null;
}

export async function getGpt02Job135TimelineReadback(x:Input) {
  if (process.env["APP_ENV"]==="production"||
      process.env["NODE_ENV"]!=="development") return denied("DEV_ONLY");
  const invalid=validateGpt02TimelineReadbackInput(x);
  if(invalid)return denied(invalid);
  // A deployed DEV may not yet have the recovery reservation migration.
  // Read the authenticated Human Review first using existing baseline tables,
  // then detect optional reservation schema without executing a query against
  // a missing table. No migration is applied by this diagnostic.
  const subject=await db.execute(sql`
    SELECT t.id,t.status,t.assigned_user,t.payload_json
    FROM ai_platform.ai_human_tasks t
    WHERE t.id=${x.humanReviewId}
      AND t.source_module='ai_core_lifecycle'
      AND t.payload_json->>'commandId'=${x.parentCommandId}
      AND t.payload_json->>'taskId'=${String(x.jobId)}
    LIMIT 1
  `);
  const row=subject.rows?.[0];
  if(!row)return denied("HUMAN_REVIEW_JOB_BINDING_NOT_FOUND");
  const schema=await db.execute(sql`
    SELECT to_regclass('ai_platform.gpt02_dev_recovery_reservations') IS NOT NULL
      AS reservations_present,
      CASE WHEN to_regclass('ai_platform.gpt02_dev_recovery_reservations') IS NOT NULL
        THEN has_table_privilege(current_user,
          'ai_platform.gpt02_dev_recovery_reservations','SELECT')
        ELSE false END AS reservations_readable
  `);
  if(typeof schema.rows?.[0]?.["reservations_present"]!=="boolean" ||
     typeof schema.rows?.[0]?.["reservations_readable"]!=="boolean")
    return denied("RESERVATION_SCHEMA_READBACK_UNAVAILABLE");
  const reservationsPresent=schema.rows[0]["reservations_present"]===true;
  const reservationsReadable=schema.rows[0]["reservations_readable"]===true;
  let candidate:string|null=null;
  if(reservationsPresent && reservationsReadable){
    const reservation=await db.execute(sql`
      SELECT r.candidate_command_id
      FROM ai_platform.gpt02_dev_recovery_reservations r
      WHERE r.human_review_id=${x.humanReviewId} AND r.job_id=${x.jobId}
        AND r.parent_command_id=${x.parentCommandId}::uuid
      LIMIT 1
    `);
    const item=reservation.rows?.[0]?.["candidate_command_id"];
    if(item!==undefined && item!==null && (typeof item!=="string" || !uuid.test(item)))
      return denied("RECOVERY_CANDIDATE_IDENTITY_INVALID");
    candidate=typeof item==="string"?item:null;
  }
  const commandIds=[x.parentCommandId,...(candidate?[candidate]:[])];
  const history=await db.execute(sql`
    SELECT id,command_id,kind,created_at,acknowledged_at
    FROM ai_platform.ai_coding_bridge_responses
    WHERE command_id=${x.parentCommandId}::uuid
       ${candidate ? sql`OR command_id=${candidate}::uuid` : sql``}
    ORDER BY created_at ASC,id ASC
    LIMIT 101
  `);
  const rows=history.rows??[];
  if(rows.length>100)return denied("TIMELINE_RESPONSE_LIMIT_REACHED");
  if(rows.some(r=>!kinds.has(String(r["kind"])) ||
    !uuid.test(String(r["command_id"]))||
    !commandIds.includes(String(r["command_id"]))))
    return denied("TIMELINE_RESPONSE_INVALID");
  // Independently verified checkpoint attestation/ACK is an aggregate tied
  // to the latest checkpoint ID, not an arbitrary worker-supplied flag.
  const parentProof=await getCodingCommandLifecycleEvidence(x.parentCommandId);
  const childProof=candidate?await getCodingCommandLifecycleEvidence(candidate):null;
  const evidence=rows.map(r=>{
    const id=String(r["id"]);
    const commandId=String(r["command_id"]);
    const proof=commandId===x.parentCommandId?parentProof:childProof;
    const verifiedCheckpoint=proof?.found===true &&
      proof.checkpointResponseId===id && r["kind"]==="CHECKPOINT";
    const createdAt=r["created_at"] instanceof Date?r["created_at"]:
      r["created_at"]?new Date(String(r["created_at"])):null;
    return {
      id,commandId,kind:String(r["kind"]) as TimelineResponse["kind"],
      createdAt,
      nativeAttestationVerified:verifiedCheckpoint && proof.checkpointAttested,
      receiverAckVerified:verifiedCheckpoint && proof.nativeReceiverAckVerified,
      // No final-result cryptographic verifier in this workflow yet.
      resultVerified:false,
    };
  });
  const projection=projectGpt02Job135Timeline({
    jobId:x.jobId,parentCommandId:x.parentCommandId,candidateCommandId:candidate,
    accountableOwner:typeof row["assigned_user"]==="string"?row["assigned_user"]:null,
    assignedWorkerId:null, // worker claim requires independent verified assignment
    reviewAccepted:row["status"]==="accepted",responses:evidence,
  });
  return {ok:true as const,reviewOnly:true as const,
    mayCreateCommand:false as const,
    reservationSchemaAvailable:reservationsPresent,
    reservationReadbackStatus:!reservationsPresent?"MIGRATION_MISSING":
      !reservationsReadable?"SELECT_PERMISSION_DENIED":
      candidate===null?"NO_RESERVATION_FOR_REVIEW":"CANDIDATE_ID_READ_ONLY",
    reservationEvidenceVerified:reservationsPresent && reservationsReadable && candidate!==null,
    ...projection,mayDispatchWorker:false as const,mayCloseJob:false as const};
}
