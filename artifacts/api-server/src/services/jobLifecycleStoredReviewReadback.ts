/** DEV-only database-backed verification of a persisted review.
 * Diagnostic ONLY. Queries are separate READ-ONLY snapshots; the result must
 * never authorize a grant. Issuance requires separate atomic revalidation.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getDevCommandRecoveryReview } from "./jobLifecycleRecoveryReview.js";
import { assessStoredDevOperatorReview, type StoredReviewSnapshot, type CurrentOperatorSnapshot } from "./jobLifecycleStoredReviewPreflight.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date=(v:unknown):Date|null=>{
 const d=v instanceof Date?v:typeof v==="string"?new Date(v):null;
 return d&&Number.isFinite(d.getTime())?d:null;
};
const string=(v:unknown)=>typeof v==="string"?v:"";
const deny=(reason:string)=>({verified:false,reason,mayIssueGrant:false as const,
 mayDispatchWorker:false as const,mayCloseJob:false as const});

export async function getDevStoredReviewReadback(input:{
 reviewId:string;trustedPublicKeyDerBase64:string|undefined;now?:Date;
}) {
 if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production")
  return deny("DEV_ONLY");
 if(!uuid.test(input.reviewId))return deny("INVALID_REVIEW_ID");
 // No trusted verifier key means no meaningful proof check. Fail before
 // querying the review, operator, or command; do not infer authorization
 // from a database FK or shape-only proof constraints.
 if(!input.trustedPublicKeyDerBase64)
  return deny("STORED_REVIEW_TRUST_KEY_UNCONFIGURED");
 const now=input.now??new Date();
 if(!Number.isFinite(now.getTime()))return deny("INVALID_TIME");
 try {
  const reviews=await db.execute(sql`
   SELECT id,command_id,checkpoint_response_id,blocker_response_id,worker_id,
    operator_user_id,operator_role,nonce,signed_at,expires_at,proof_json
   FROM ai_platform.dev_gpt02_operator_review_intents
   WHERE id=${input.reviewId}::uuid LIMIT 1
  `);
  const row=reviews.rows?.[0];
  if(!row)return deny("STORED_REVIEW_NOT_FOUND");
  const signedAt=date(row["signed_at"]),expiresAt=date(row["expires_at"]);
  const userId=Number(row["operator_user_id"]);
  if(!signedAt||!expiresAt||!Number.isSafeInteger(userId)||userId<1)
   return deny("STORED_REVIEW_ROW_INVALID");
  // An expired stored review cannot regain authority. Avoid further lookups.
  if(signedAt.getTime()>now.getTime()||expiresAt.getTime()<=now.getTime()||
     expiresAt.getTime()<=signedAt.getTime()||
     expiresAt.getTime()-signedAt.getTime()>120_000)
   return deny("STORED_REVIEW_EXPIRED_OR_INVALID");
  const review:StoredReviewSnapshot={
   id:string(row["id"]),commandId:string(row["command_id"]),
   checkpointResponseId:string(row["checkpoint_response_id"]),
   blockerResponseId:string(row["blocker_response_id"]),
   workerId:string(row["worker_id"]),operatorUserId:userId,
   operatorRole:string(row["operator_role"]),nonce:string(row["nonce"]),
   signedAt,expiresAt,proof:row["proof_json"],
  };
  if(review.id!==input.reviewId)return deny("STORED_REVIEW_ID_MISMATCH");
  const users=await db.execute(sql`
   SELECT id,role,status,account_type,must_change_password
   FROM ai_platform.internal_users WHERE id=${userId} LIMIT 1
  `);
  const user=users.rows?.[0];
  const operator:CurrentOperatorSnapshot|null=user?{
   id:Number(user["id"]),role:string(user["role"]),status:string(user["status"]),
   accountType:string(user["account_type"]),
   mustChangePassword:user["must_change_password"]!==false,
  }:null;
  // Separate read-only facts are not an atomic authorization snapshot.
  const cmd=await getDevCommandRecoveryReview(review.commandId);
  if(!cmd.found)return deny("CURRENT_COMMAND_NOT_FOUND");
  const result=assessStoredDevOperatorReview({
   review,operator,now,trustedPublicKeyDerBase64:input.trustedPublicKeyDerBase64,
   evidence:{
    commandId:review.commandId,commandStatus:cmd.commandStatus,
    checkpointResponseId:cmd.checkpointResponseId,
    blockerResponseId:cmd.blockingResponseId,
    workerId:"openclaw-dell-chatgpt-wake-dev",
    responseSnapshotComplete:cmd.responseSnapshotComplete,
    checkpointAttested:cmd.checkpointAttested,
    nativeReceiverAckVerified:cmd.receiverAckVerified,
    blockerEvidenceValid:cmd.blockerEvidenceValid,
   },
  });
  return {verified:result.reviewVerified,reason:result.reason,
   snapshotAtomic:false as const,grantIssuanceEnabled:false as const,
   mayIssueGrant:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const};
 } catch {
  return deny("STORED_REVIEW_READBACK_UNAVAILABLE");
 }
}
