/**
 * Issue159 DEV: dormant signed-release -> one-use Postgres claim admission.
 *
 * NO HTTP/worker/gateway client, private key, DB credentials or automatic
 * startup. Only records immutable RESERVED_NO_DISPATCH intent.
 * The release signer and independent pinned public root are not installed.
 */
import { createHash } from "node:crypto";
import {
  canonicalIssue159Release, verifyIssue159ReleaseUsingPinnedRoot,
} from "./dev-gpt02-issue159-release-authorization.mjs";
import { BridgeViolation } from "./dev-gpt02-gateway-bridge.mjs";

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const CLAIM_ROLE="dev_gpt02_claim_gate_login";
const ROLE_SQL="SELECT session_user::text AS session_login, current_user::text AS active_role";
const CLAIM_SQL="SELECT gpt02_private.reserve_issue159_release_claim("+
 "$1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,"+
 "$8::uuid,$9::text,$10::text,$11::bigint,$12::bigint) AS claim_id";
const READBACK_SQL="SELECT gpt02_private.inspect_issue159_release_claim("+
 "$1::uuid,$2::text,$3::text) AS status";

function ensure(value,code) {
  if (!value) throw new BridgeViolation(code);
}
const hashBytes=bytes=>createHash("sha256").update(bytes).digest("hex");
function assertRole(rows) {
  ensure(Array.isArray(rows) && rows.length === 1 &&
    rows[0]?.session_login === CLAIM_ROLE &&
    rows[0]?.active_role === CLAIM_ROLE,
    "EXCLUSIVE_RELEASE_CLAIM_ROLE_REQUIRED");
}
function canonicalUuid(value) {
  ensure(typeof value === "string" && UUID.test(value),
    "CLAIM_OR_COMMAND_UUID_INVALID");
  return value;
}

/**
 * Pure audit-binding derivation. No database rights or dispatch authority.
 * A caller can forge a "proof"; this helper never reserves or sends.
 * The operational function below obtains proof from the pinned verifier.
 */
export function deriveIssue159ClaimParameters({ release, signatureBase64, proof }) {
  ensure(release && typeof release === "object" && proof &&
    typeof proof === "object" && proof.environment === "DEV" &&
    proof.stage === "SIGNED_RELEASE_READY_FOR_SEPARATELY_AUTHORIZED_TRANSPORT" &&
    proof.releaseDecision === "NO_GO" &&
    proof.dispatchPermitted === false &&
    proof.oneUseDatabaseFenceVerified === false &&
    proof.workerCommandSent === false &&
    proof.work?.commandId === release.commandId &&
    proof.work?.eventId === release.eventId &&
    proof.work?.challenge === release.challenge &&
    proof.work?.ownerChannel === release.ownerChannel &&
    proof.work?.targetConversationId === release.targetConversationId,
    "VERIFIED_RELEASE_CANDIDATE_REQUIRED");
  ensure(typeof signatureBase64 === "string" &&
    /^[A-Za-z0-9+/]{86}==$/.test(signatureBase64),
    "RELEASE_SIGNATURE_CANONICAL_REQUIRED");
  const signature=Buffer.from(signatureBase64,"base64");
  ensure(signature.length === 64 && signature.toString("base64") === signatureBase64,
    "RELEASE_SIGNATURE_CANONICAL_REQUIRED");
  const releaseSha=hashBytes(canonicalIssue159Release(release));
  const signatureSha=hashBytes(signature);
  const params=[
    canonicalUuid(release.commandId),
    canonicalUuid(release.permitId),
    release.packetSha256,
    releaseSha,
    signatureSha,
    release.instructionSha256,
    release.ownerChannel,
    canonicalUuid(release.targetConversationId),
    release.eventId,
    release.challenge,
    release.issuedAt,
    release.expiresAt,
  ];
  ensure(params[2] && HEX.test(params[2]) &&
    HEX.test(params[3]) && HEX.test(params[4]) &&
    HEX.test(params[5]) && HEX.test(params[8]) && HEX.test(params[9]) &&
    Number.isSafeInteger(params[10]) && Number.isSafeInteger(params[11]),
    "RELEASE_CLAIM_BINDING_INVALID");
  return Object.freeze({
    params: Object.freeze(params),
    commandId: params[0],
    eventId: params[8],
    releaseSha256: releaseSha,
    signatureSha256: signatureSha,
    dispatchPermitted: false,
    releaseDecision: "NO_GO",
  });
}

/**
 * ONLY operational admission entrypoint:
 * no injected verifier/clock/public key and no network/worker client.
 * Requires independently provisioned dedicated DB role, which is ABSENT
 * in live CST-DEV. A COMMIT uncertainty is NEVER an invitation to retry.
 */
export async function reserveIssue159ClaimWithoutDispatch(input, connection) {
  ensure(process.env.APP_ENV === "development" &&
    process.env.GPT02_ISSUE159_CLAIM_ADMISSION_ENABLED === "true",
    "CLAIM_ADMISSION_DISABLED");
  ensure(input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === 4 &&
    ["release","signatureBase64","held","binding"]
      .every(k=>Object.prototype.hasOwnProperty.call(input,k)),
    "OPERATIONAL_CLAIM_INPUT_INVALID");
  const proof=verifyIssue159ReleaseUsingPinnedRoot(input);
  const binding=deriveIssue159ClaimParameters({
    release: input.release, signatureBase64: input.signatureBase64, proof,
  });
  ensure(connection && typeof connection.query === "function",
    "CLAIM_DB_CONNECTION_REQUIRED");
  let transactionStarted=false;
  try {
    await connection.query("BEGIN");
    transactionStarted=true;
    const role=await connection.query(ROLE_SQL);
    assertRole(role?.rows);
    const result=await connection.query(CLAIM_SQL,binding.params);
    const claimId=result?.rows?.[0]?.claim_id;
    canonicalUuid(claimId);
    ensure(result.rows.length === 1, "CLAIM_RESULT_SHAPE_INVALID");
    await connection.query("COMMIT");
    transactionStarted=false;
    return Object.freeze({
      environment:"DEV",
      stage:"IMMUTABLE_CLAIM_RESERVED_NO_DISPATCH",
      claimId, commandId:binding.commandId, eventId:binding.eventId,
      releaseSha256:binding.releaseSha256,
      immutableClaimRecorded:true,
      workerCommandSent:false, gatewayDispatched:false,
      finalAckVerified:false, dispatchPermitted:false,
      releaseDecision:"NO_GO",
    });
  } catch {
    if(transactionStarted) {
      try {await connection.query("ROLLBACK");} catch {}
    }
    // A previous COMMIT might have succeeded. No automatic second attempt.
    throw new BridgeViolation("CLAIM_RESERVATION_OUTCOME_UNCERTAIN_NO_DISPATCH");
  }
}

/**
 * Post-crash read-only status. A previously recorded claim requires gateway
 * idempotency reconciliation; it must never trigger a second send.
 */
export async function inspectIssue159ClaimAfterCrash(selectors, connection) {
  // Recovery remains available with dispatch disabled, but never outside DEV
  // and never accepts caller-supplied authority, clock, root or work payload.
  ensure(process.env.APP_ENV === "development",
    "CLAIM_READBACK_DEV_ONLY");
  ensure(selectors && typeof selectors === "object" &&
    !Array.isArray(selectors) &&
    Object.keys(selectors).length === 3 &&
    ["commandId","releaseSha256","eventId"]
      .every(k=>Object.prototype.hasOwnProperty.call(selectors,k)),
    "CLAIM_READBACK_INPUT_SHAPE_INVALID");
  const {commandId,releaseSha256,eventId}=selectors;
  canonicalUuid(commandId);
  ensure(typeof releaseSha256 === "string" && HEX.test(releaseSha256) &&
    typeof eventId === "string" && HEX.test(eventId),
    "CLAIM_READBACK_SELECTORS_INVALID");
  ensure(connection && typeof connection.query === "function",
    "CLAIM_DB_CONNECTION_REQUIRED");
  const role=await connection.query(ROLE_SQL);
  assertRole(role?.rows);
  const result=await connection.query(READBACK_SQL,
    [commandId,releaseSha256,eventId]);
  const status=result?.rows?.[0]?.status;
  ensure(result?.rows?.length === 1 &&
    (status === "RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED" ||
     status === "NO_MATCHING_CLAIM_DO_NOT_SEND"),
    "CLAIM_READBACK_RESULT_INVALID");
  return Object.freeze({
    environment:"DEV",commandId,eventId,
    claimStatus:status,
    gatewayLookupRequired:
      status === "RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED",
    gatewayDispatched:false,workerCommandSent:false,
    dispatchPermitted:false,releaseDecision:"NO_GO",
  });
}
