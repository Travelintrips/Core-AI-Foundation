/**
 * DEV-only server verification of a native fence proof against a durable,
 * immutable signing receipt and the CURRENT database lease.
 *
 * Pure readback: no public route, command issue, replay, worker dispatch,
 * command completion, or ACK authority. A successful proof cannot substitute
 * for the missing authorized issuer and native final assistant response.
 */
import { createHash, verify, type KeyObject } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { canonicalGpt02NativeRecoveryFenceProof, type Gpt02NativeRecoveryFenceProof }
  from "./gpt02NativeRecoveryFenceProofContract.js";

const sha=/^[0-9a-f]{64}$/;
const deny=(reason:string)=>({
  ok:false as const,reason,
  mayCreateCommand:false as const,
  mayDispatchWorker:false as const,
  mayCloseJob:false as const,
  nativeFinalAckVerified:false as const,
});
type Envelope={proof:Gpt02NativeRecoveryFenceProof;signature:string};
export async function verifyGpt02DevCurrentFenceReceipt(
  envelope:Envelope, pinnedServerPublicKey:KeyObject,
) {
  if(process.env["APP_ENV"]!=="development" ||
     process.env["NODE_ENV"]!=="development")
    return deny("NOT_DEV");
  // The verifier does not enable the signer or authorization flags.
  if(!pinnedServerPublicKey || pinnedServerPublicKey.type!=="public" ||
     pinnedServerPublicKey.asymmetricKeyType!=="ed25519")
    return deny("PINNED_SERVER_PUBLIC_KEY_REQUIRED");
  if(!envelope || typeof envelope!=="object" ||
     Object.keys(envelope).length!==2 ||
     typeof envelope.signature!=="string" ||
     !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))
    return deny("INVALID_SIGNED_ENVELOPE");
  let canonical:Buffer;
  try {
    canonical=canonicalGpt02NativeRecoveryFenceProof(envelope.proof);
  } catch {
    return deny("INVALID_CANONICAL_PROOF");
  }
  const signature=Buffer.from(envelope.signature,"base64");
  if(signature.length!==64 ||
     signature.toString("base64")!==envelope.signature ||
     !verify(null,canonical,pinnedServerPublicKey,signature))
    return deny("SIGNATURE_NOT_VERIFIED");
  const p=envelope.proof;
  // Sequence zero is the ONLY signed sequence issued by this DEV prototype.
  if(p.sequence!==0) return deny("UNSUPPORTED_INITIAL_SEQUENCE");
  const payloadHash=createHash("sha256").update(canonical).digest("hex");
  const signatureHash=createHash("sha256").update(signature).digest("hex");
  return db.transaction(async tx=>{
    // Lock the same reservation/lineage/lease/command/receipt identity.
    // This check is a point-in-time proof, NOT a grant after commit.
    const read=await tx.execute(sql`
      SELECT f.payload_sha256,f.signature_sha256,
        f.issued_at_utc_ms::text AS issued_ms,
        f.expires_at_utc_ms::text AS expires_ms,
        l.fencing_token::text AS current_token,
        (floor(extract(epoch from clock_timestamp())*1000))::bigint::text AS now_ms
      FROM ai_platform.gpt02_dev_native_fence_signing_receipts f
      JOIN ai_platform.gpt02_dev_recovery_reservations r
        ON r.id=f.reservation_id AND r.candidate_command_id=f.child_command_id
      JOIN ai_platform.gpt02_dev_recovery_command_links li
        ON li.reservation_id=r.id
       AND li.parent_command_id=r.parent_command_id
       AND li.child_command_id=f.child_command_id
      JOIN ai_platform.gpt02_dev_recovery_leases l
        ON l.reservation_id=r.id
      JOIN ai_platform.ai_coding_bridge_commands parent
        ON parent.id=r.parent_command_id
      JOIN ai_platform.ai_coding_bridge_commands child
        ON child.id=f.child_command_id
      WHERE f.reservation_id=${p.reservationId}::uuid
        AND f.child_command_id=${p.childCommandId}::uuid
        AND li.parent_command_id=${p.parentCommandId}::uuid
        AND r.human_review_id=${p.humanReviewId}
        AND r.job_id=${p.jobId}
        AND r.artifact_sha256=${p.artifactSha256}
        AND f.worker_id=${p.workerId}
        AND f.sequence=0
        AND f.fencing_token=${p.fencingToken}::bigint
        AND f.issued_at_utc_ms=${p.issuedAtUtcMs}::bigint
        AND f.expires_at_utc_ms=${p.expiresAtUtcMs}::bigint
        AND r.execution_authorized IS TRUE
        AND parent.status='FAILED' AND child.status='RECEIVED'
        AND l.lease_owner=${p.workerId}
        AND l.fencing_token=${p.fencingToken}::bigint
        AND l.lease_expires_at>clock_timestamp()
      FOR SHARE OF f,r,li,l,parent,child
    `);
    if(read.rows?.length!==1)
      return deny("SIGNED_RECEIPT_OR_CURRENT_LEASE_NOT_PROVEN");
    const row=read.rows[0] as Record<string,unknown>;
    if(typeof row["payload_sha256"]!=="string" ||
       typeof row["signature_sha256"]!=="string" ||
       !sha.test(row["payload_sha256"]) || !sha.test(row["signature_sha256"]) ||
       row["payload_sha256"]!==payloadHash ||
       row["signature_sha256"]!==signatureHash)
      return deny("SIGNING_RECEIPT_DIGEST_MISMATCH");
    const nums=[row["issued_ms"],row["expires_ms"],row["current_token"],row["now_ms"]];
    if(nums.some(x=>typeof x!=="string" || !/^\d+$/.test(x as string)))
      return deny("DB_FENCE_TIME_INVALID");
    const [issued,expires,fence,now]=nums.map(Number);
    if([issued,expires,fence,now].some(x=>!Number.isSafeInteger(x)) ||
       issued!==p.issuedAtUtcMs || expires!==p.expiresAtUtcMs ||
       fence!==p.fencingToken || now<issued-2000 || now>=expires)
      return deny("FENCE_EXPIRED_OR_STALE");
    // Readback is not a dispatch grant. Native final response is independent.
    return {ok:true as const,reason:"RECEIPT_AND_LEASE_VERIFIED_AT_READ",
      reservationId:p.reservationId,childCommandId:p.childCommandId,
      mayCreateCommand:false as const,mayDispatchWorker:false as const,
      mayCloseJob:false as const,nativeFinalAckVerified:false as const};
  });
}
