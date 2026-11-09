/**
 * DEV GPT02 native fence signer prototype, deliberately NOT routed.
 *
 * This is not an execution issuer. The current reservation schema forces
 * execution_authorized=false, so a real DEV row cannot pass the final gate.
 * A future authorized issuer must additionally prove exclusion of untagged
 * legacy attempts and must not reuse this service for generic claims.
 *
 * The signer retains a database row lock until Ed25519 signing completes.
 * Never accept key material or verification booleans from an HTTP request.
 */
import { sign, type KeyObject } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { canonicalGpt02NativeRecoveryFenceProof } from "./gpt02NativeRecoveryFenceProofContract.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKER=/^[A-Za-z0-9_.:-]{1,128}$/;
type Subject = {
  reservationId:string; parentCommandId:string; childCommandId:string;
  workerId:string; jobId:number; humanReviewId:number;
};
const deny=(reason:string)=>({
  ok:false as const,reason,mayDispatchWorker:false as const,
  mayCreateCommand:false as const,mayCloseJob:false as const,
  nativeAckVerified:false as const,
});

export function validateGpt02ServerFenceSigningSubject(x:Subject):string|null {
  if(!x||typeof x!=="object"||
     !UUID.test(x.reservationId)||!UUID.test(x.parentCommandId)||
     !UUID.test(x.childCommandId)||x.parentCommandId===x.childCommandId)
    return "INVALID_FENCE_SUBJECT";
  if(typeof x.workerId!=="string"||!WORKER.test(x.workerId)||
     !Number.isSafeInteger(x.jobId)||x.jobId<=0||x.jobId>2147483647||
     !Number.isSafeInteger(x.humanReviewId)||x.humanReviewId<=0||
     x.humanReviewId>2147483647) return "INVALID_FENCE_SUBJECT";
  return null;
}
function signingEnabled(){
  return process.env["APP_ENV"]==="development" &&
    process.env["NODE_ENV"]==="development" &&
    process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]==="true" &&
    process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"]==="true" &&
    process.env["AI_CORE_DEV_GPT02_NATIVE_FENCE_SIGNING_ENABLED"]==="true";
}

/** One-shot sequence=0 only. Renewal must have a separate durable sequence. */
export async function signGpt02DevInitialFence(
  input:Subject, privateKey:KeyObject,
) {
  if(!signingEnabled()) return deny("NATIVE_FENCE_SIGNING_DISABLED");
  const invalid=validateGpt02ServerFenceSigningSubject(input);
  if(invalid)return deny(invalid);
  if(!privateKey||privateKey.type!=="private"||
     privateKey.asymmetricKeyType!=="ed25519")
    return deny("PINNED_SERVER_ED25519_PRIVATE_KEY_REQUIRED");
  return db.transaction(async tx=>{
    // No trust in caller-provided lease, artifact or reviewer booleans.
    // All identities must match the durable reservation, command lineage,
    // current worker ownership and unexpired lease under the same DB lock.
    const result=await tx.execute(sql`
      SELECT r.artifact_sha256, l.fencing_token::text AS fencing_token,
        (floor(extract(epoch from clock_timestamp())*1000))::bigint::text AS now_ms,
        (floor(extract(epoch from LEAST(
          l.lease_expires_at,clock_timestamp()+interval '30 seconds'
        ))*1000))::bigint::text AS expiration_ms
      FROM ai_platform.gpt02_dev_recovery_reservations r
      JOIN ai_platform.gpt02_dev_recovery_command_links li
        ON li.reservation_id=r.id
       AND li.parent_command_id=r.parent_command_id
       AND li.child_command_id=r.candidate_command_id
      JOIN ai_platform.gpt02_dev_recovery_leases l ON l.reservation_id=r.id
      JOIN ai_platform.ai_coding_bridge_commands parent
        ON parent.id=r.parent_command_id
      JOIN ai_platform.ai_coding_bridge_commands child
        ON child.id=li.child_command_id
      WHERE r.id=${input.reservationId}::uuid
        AND r.parent_command_id=${input.parentCommandId}::uuid
        AND r.candidate_command_id=${input.childCommandId}::uuid
        AND r.job_id=${input.jobId}
        AND r.human_review_id=${input.humanReviewId}
        AND r.execution_authorized IS TRUE
        AND parent.status='FAILED'
        AND child.status='RECEIVED'
        AND l.lease_owner=${input.workerId}
        AND l.fencing_token>0
        AND l.lease_expires_at>clock_timestamp()+interval '1 second'
      FOR UPDATE OF r,li,l,parent,child
    `);
    const rows=result.rows??[];
    if(rows.length!==1) return deny("CURRENT_AUTHORIZED_LEASE_NOT_PROVEN");
    const row=rows[0] as Record<string,unknown>;
    if(typeof row["artifact_sha256"]!=="string"||
       !/^[0-9a-f]{64}$/.test(row["artifact_sha256"])||
       typeof row["fencing_token"]!=="string"||
       typeof row["now_ms"]!=="string"||
       typeof row["expiration_ms"]!=="string")
      return deny("SIGNED_FENCE_DB_PROOF_INVALID");
    const fence=Number(row["fencing_token"]);
    const issued=Number(row["now_ms"]);
    const expires=Number(row["expiration_ms"]);
    if(![fence,issued,expires].every(Number.isSafeInteger)||
       fence<=0||issued<=0||expires<=issued||
       expires-issued>30000||expires-issued<1000)
      return deny("SIGNED_FENCE_LIFETIME_INVALID");
    const proof={
      protocol:"ai-core-gpt02-recovery-fence/v1",
      reservationId:input.reservationId,parentCommandId:input.parentCommandId,
      childCommandId:input.childCommandId,
      humanReviewId:input.humanReviewId,jobId:input.jobId,
      workerId:input.workerId,
      artifactSha256:row["artifact_sha256"],
      fencingToken:fence,sequence:0,
      issuedAtUtcMs:issued,expiresAtUtcMs:expires,
    };
    const signature=sign(null,canonicalGpt02NativeRecoveryFenceProof(proof),privateKey);
    return {ok:true as const,proof,signature:signature.toString("base64"),
      // Proof creation is not a worker dispatch or native ACK.
      mayCreateCommand:false as const,mayDispatchWorker:false as const,
      mayCloseJob:false as const,nativeAckVerified:false as const};
  });
}
