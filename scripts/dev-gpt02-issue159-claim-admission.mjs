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
import { BridgeViolation, validateTrustedBinding } from "./dev-gpt02-gateway-bridge.mjs";

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const CLAIM_ROLE="dev_gpt02_claim_gate_login";
const WORKER="openclaw-dell-chatgpt-wake-dev";
const ROLE_SQL="SELECT session_user::text AS session_login, current_user::text AS active_role";
const CLAIM_SQL="SELECT gpt02_private.reserve_issue159_release_claim("+
 "$1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,"+
 "$8::uuid,$9::text,$10::text,$11::bigint,$12::bigint) AS claim_id";
const HELD_READ_SQL="SELECT gpt02_private.read_issue159_held_for_claim("+ 
 "$1::uuid,$2::uuid,$3::text) AS held";
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
 * Query independent Gateway credential identity as in existing trusted
 * callback contract. A shape-valid binding from a request is NOT proof.
 * The host must provide trusted methods from its server-owned registry and
 * authenticated Gateway credential store, not from caller-controlled data.
 * This module is read-only and cannot instantiate credentials or send work.
 */
export async function resolveIssue159TrustedGatewayBinding(release,trusted) {
  ensure(release && typeof release === "object" &&
    release.environment === "DEV" &&
    release.workerId === WORKER &&
    trusted && typeof trusted === "object" &&
    typeof trusted.loadBinding === "function" &&
    typeof trusted.inspectGatewayCredential === "function" &&
    typeof trusted.inspectGatewayReachability === "function" &&
    typeof trusted.inspectOpenClawModelStatus === "function",
    "TRUSTED_GATEWAY_READ_ADAPTER_REQUIRED");
  const binding=await trusted.loadBinding(WORKER);
  validateTrustedBinding(binding);
  ensure(binding.accountAlias === "GPT02" &&
    binding.workerId === WORKER &&
    binding.ownerChannel === release.ownerChannel &&
    binding.targetConversationId === release.targetConversationId &&
    binding.gatewayAgentId === release.gatewayAgentId &&
    binding.provider === release.provider &&
    binding.principalFingerprint === release.principalFingerprint &&
    binding.proofId === release.gatewayProofId,
    "TRUSTED_GATEWAY_BINDING_RELEASE_MISMATCH");
  const identity=await trusted.inspectGatewayCredential(binding.gatewayAgentId);
  ensure(identity && typeof identity === "object" &&
    identity.authenticated === true &&
    // A saved OAuth/API-key profile is not the same as usable authentication
    // for the selected OpenClaw runtime and model route. Read this from the
    // host-owned provider inspector; absent/unknown must fail closed.
    identity.runtimeAuthStatus === "ready" &&
    identity.modelRouteReady === true &&
    identity.source === "gateway-credential-store" &&
    identity.gatewayAgentId === binding.gatewayAgentId &&
    identity.provider === binding.provider &&
    identity.principalFingerprint === binding.principalFingerprint &&
    // A claimed source is not sufficient: the independently inspected
    // credential proof must be the same proof authorized by the release.
    identity.proofId === binding.proofId,
    "INDEPENDENT_GATEWAY_PROVIDER_IDENTITY_UNVERIFIED");
  // A model config snapshot can exist even when the live Gateway is down.
  // This separate host-owned read-only reachability port must observe the
  // actual DELL loopback endpoint just before claim admission. No send.
  const health=await trusted.inspectGatewayReachability(WORKER);
  const ageMs=Date.now()-health?.observedAtMs;
  ensure(health?.source === "local-openclaw-gateway" &&
    health.endpoint === "ws://127.0.0.1:18789" &&
    health.reachable === true &&
    Number.isSafeInteger(health.observedAtMs) &&
    ageMs >= 0 && ageMs <= 5000,
    "TRUSTED_GPT02_GATEWAY_UNREACHABLE");
  // Check the selected model's actual Gateway state separately from stored
  // profile metadata. These methods must be supplied by the HOST, not a job.
  const modelStatus=await trusted.inspectOpenClawModelStatus("gpt02-dev");
  const auth=modelStatus?.auth;
  const routes=auth?.runtimeAuthRoutes;
  const openaiRoutes=Array.isArray(routes) ? routes.filter(r=>
    r?.provider === "openai" && r?.runtime === "codex") : [];
  ensure(modelStatus?.agentId === "gpt02-dev" &&
    modelStatus.defaultModel === "openai/gpt-5.5" &&
    modelStatus.resolvedDefault === "openai/gpt-5.5" &&
    typeof auth?.storePath === "string" &&
    auth.storePath.replace(/\\/g,"/").toLowerCase()
      .endsWith("/agents/gpt02-dev/agent/openclaw-agent.sqlite") &&
    openaiRoutes.length === 1 &&
    (openaiRoutes[0].status === "ok" ||
     openaiRoutes[0].status === "ready") &&
    Array.isArray(auth.modelRouteIssues) &&
    !auth.modelRouteIssues.some(issue=>issue?.provider === "openai") &&
    Array.isArray(auth.missingProvidersInUse) &&
    !auth.missingProvidersInUse.includes("openai"),
    "TRUSTED_GPT02_MODEL_ROUTE_UNREADY");
  return Object.freeze({ ...binding });
}

/**
 * ONLY operational admission entrypoint:
 * HELD row is retrieved from the SAME dedicated DB connection before the
 * pinned-key verifier runs. Caller cannot inject held or overwrite the
 * server clock, trust root or database session; no gateway/worker client.
 * Requires independently provisioned dedicated DB role, which is ABSENT
 * in live CST-DEV. A COMMIT uncertainty is NEVER an invitation to retry.
 */
export async function reserveIssue159ClaimWithoutDispatch(input, connection, trusted) {
  ensure(process.env.APP_ENV === "development" &&
    process.env.GPT02_ISSUE159_CLAIM_ADMISSION_ENABLED === "true",
    "CLAIM_ADMISSION_DISABLED");
  ensure(input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === 2 &&
    ["release","signatureBase64"]
      .every(k=>Object.prototype.hasOwnProperty.call(input,k)),
    "OPERATIONAL_CLAIM_INPUT_INVALID");
  ensure(connection && typeof connection.query === "function" &&
    typeof connection.connect !== "function",
    "DEDICATED_CLAIM_DB_CLIENT_REQUIRED");
  let transactionStarted=false;
  try {
    await connection.query("BEGIN");
    transactionStarted=true;
    const role=await connection.query(ROLE_SQL);
    assertRole(role?.rows);
    // SQL SECURITY DEFINER reads the actual consumed outbox, matching
    // Core Task and HELD bridge row. No caller-supplied HELD JSON is accepted.
    const release=input.release;
    ensure(release && typeof release === "object" &&
      typeof release.commandId === "string" &&
      typeof release.permitId === "string" &&
      typeof release.packetSha256 === "string",
      "SIGNED_RELEASE_IDENTIFIERS_REQUIRED");
    const heldRead=await connection.query(HELD_READ_SQL,[
      canonicalUuid(release.commandId),
      canonicalUuid(release.permitId),
      release.packetSha256,
    ]);
    ensure(heldRead?.rows?.length === 1 &&
      heldRead.rows[0]?.held &&
      typeof heldRead.rows[0].held === "object" &&
      !Array.isArray(heldRead.rows[0].held),
      "AUTHENTICATED_HELD_READBACK_UNAVAILABLE");
    const bindingFromRegistry=await resolveIssue159TrustedGatewayBinding(
      release, trusted,
    );
    const proof=verifyIssue159ReleaseUsingPinnedRoot({
      release: input.release, signatureBase64: input.signatureBase64,
      held: heldRead.rows[0].held, binding: bindingFromRegistry,
    });
    const binding=deriveIssue159ClaimParameters({
      release: input.release, signatureBase64: input.signatureBase64, proof,
    });
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
