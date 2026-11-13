/**
 * Issue159 DEV: signed release handoff to the EXISTING gateway-native
 * one-event transport. SOURCE ONLY — not wired to any service, no credentials
 * installed, no port, no worker send, no migration. Never use a caller-
 * supplied "approved" boolean as authority.
 *
 * The future independent release signer MUST verify persisted Super Admin
 * approval, all four signatures, Core instruction + config, owner channel,
 * target conversation, durable HELD bridge row and unused exact-ID permit
 * BEFORE it signs this narrowly scoped, short-lived release record.
 *
 * This module verifies its signature against a trusted Ed25519 public key
 * and immutable readback; it does not mint release records or dispatch.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { validateTrustedBinding, validateJob, BridgeViolation } from "./dev-gpt02-gateway-bridge.mjs";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const WORKER = "openclaw-dell-chatgpt-wake-dev";
const PINNED_PUBLIC_ROOT = "/etc/gpt02-dev/issue159-release/release-public.pem";
const PINNED_ROOT_FINGERPRINT =
  "/etc/gpt02-dev/issue159-release/fingerprint.sha256";
const FIELDS = [
  "version", "environment", "audience", "hubTaskId",
  "commandId", "attemptId", "permitId", "coreTaskId", "packetSha256",
  "instructionSha256", "ownerChannel", "targetConversationId", "workerId",
  "gatewayAgentId", "provider", "principalFingerprint", "gatewayProofId",
  "eventId", "challenge", "correlationId", "issuedAt", "expiresAt",
];
const HELD_KEYS = ["id", "taskId", "source", "commandType", "status", "externalCommandId", "instruction", "metadata"];

function requireOk(value, code) {
  if (!value) throw new BridgeViolation(code);
}
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(k => Object.prototype.hasOwnProperty.call(value, k));
}
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
export function issue159EventId(record) {
  return sha256(["gpt02-issue159-event/v1", record.commandId, record.attemptId, record.permitId].join("\n"));
}
export function issue159Challenge(record) {
  return sha256(["gpt02-issue159-challenge/v1", record.commandId, record.packetSha256, record.targetConversationId].join("\n"));
}
export function canonicalIssue159Release(record) {
  requireOk(exactKeys(record, FIELDS), "RELEASE_ENVELOPE_SHAPE_INVALID");
  return Buffer.from("GPT02_ISSUE159_RELEASE_V1\n" +
    JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, record[k]]))), "utf8");
}
/**
 * An authenticated reader MUST supply the exact persisted HELD row and
 * a trusted registry adapter MUST supply binding. Neither argument is a
 * standalone proof; only a release record signed by an independent key
 * can authorize a later, separately fenced dispatch.
 */
export function verifyIssue159ReleaseCandidate({
  release, signatureBase64, publicKeyPem, held, binding, nowMs,
}) {
  requireOk(exactKeys(held, HELD_KEYS), "TRUSTED_HELD_ROW_SHAPE_INVALID");
  requireOk(Number.isSafeInteger(nowMs) && nowMs > 0, "RELEASE_CLOCK_INVALID");
  requireOk(exactKeys(release, FIELDS), "RELEASE_ENVELOPE_SHAPE_INVALID");
  requireOk(release.version === 1 && release.environment === "DEV" &&
    release.audience === "GPT02_ISSUE159_EXACT_COMMAND_RELEASE_V1" &&
    Number.isSafeInteger(release.hubTaskId) && release.hubTaskId > 139 &&
    [release.commandId, release.attemptId, release.permitId,
      release.coreTaskId, release.targetConversationId, release.gatewayProofId]
      .every(x => typeof x === "string" && UUID.test(x)) &&
    typeof release.packetSha256 === "string" && HEX.test(release.packetSha256) &&
    typeof release.instructionSha256 === "string" && HEX.test(release.instructionSha256) &&
    release.workerId === WORKER && OWNER.test(release.ownerChannel) &&
    typeof release.gatewayAgentId === "string" &&
    /^[a-z][a-z0-9-]{1,62}$/.test(release.gatewayAgentId) &&
    typeof release.provider === "string" &&
    /^[a-z][a-z0-9-]{1,62}$/.test(release.provider) &&
    release.provider !== "ai-core" &&
    HEX.test(release.principalFingerprint) &&
    Number.isSafeInteger(release.issuedAt) &&
    Number.isSafeInteger(release.expiresAt) &&
    release.issuedAt <= nowMs && nowMs < release.expiresAt &&
    release.expiresAt > release.issuedAt &&
    release.expiresAt - release.issuedAt <= 15000,
    "EXACT_RELEASE_SCOPE_OR_EXPIRY_INVALID");
  requireOk(release.eventId === issue159EventId(release) &&
    release.challenge === issue159Challenge(release) &&
    release.correlationId ===
      "ai-task:default:" + release.hubTaskId + ":" + release.commandId.slice(0, 8),
    "RELEASE_EVENT_CORRELATION_DRIFT");

  requireOk(held.id === release.commandId &&
    held.taskId === release.coreTaskId &&
    held.source === "ai-core" &&
    held.commandType === "ISSUE159_HELD" &&
    held.status === "RECEIVED" &&
    held.externalCommandId === "gpt02-issue159:" + release.commandId &&
    typeof held.instruction === "string" && held.instruction.length > 0 &&
    held.instruction.length <= 2000 &&
    !/[\x00-\x1f\x7f]/.test(held.instruction) &&
    sha256(held.instruction) === release.instructionSha256,
    "PERSISTED_HELD_COMMAND_OR_INSTRUCTION_MISMATCH");
  const meta = held.metadata;
  const marker = meta?.gpt02Issue159PositivePermit;
  requireOk(meta && typeof meta === "object" && !Array.isArray(meta) &&
    meta.devOnly === true && meta.issue159Stage === "NO_DISPATCH" &&
    !Object.prototype.hasOwnProperty.call(meta, "assignedClientId") &&
    marker && typeof marker === "object" && !Array.isArray(marker) &&
    marker.commandId === release.commandId &&
    marker.attemptId === release.attemptId &&
    marker.permitId === release.permitId &&
    marker.deliveryState === "HELD_NO_DISPATCH",
    "PERSISTED_HELD_MARKER_INVALID");

  validateTrustedBinding(binding);
  requireOk(binding.workerId === release.workerId &&
    binding.ownerChannel === release.ownerChannel &&
    binding.targetConversationId === release.targetConversationId &&
    binding.gatewayAgentId === release.gatewayAgentId &&
    binding.provider === release.provider &&
    binding.principalFingerprint === release.principalFingerprint &&
    binding.proofId === release.gatewayProofId,
    "RELEASE_TRUSTED_GATEWAY_BINDING_MISMATCH");

  requireOk(typeof signatureBase64 === "string" &&
    /^[A-Za-z0-9+/]{86}==$/.test(signatureBase64),
    "RELEASE_SIGNATURE_FORMAT_INVALID");
  const signature = Buffer.from(signatureBase64, "base64");
  requireOk(signature.length === 64 &&
    signature.toString("base64") === signatureBase64,
    "RELEASE_SIGNATURE_NOT_CANONICAL");
  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new BridgeViolation("PINNED_RELEASE_PUBLIC_KEY_INVALID");
  }
  requireOk(key.asymmetricKeyType === "ed25519" &&
    verify(null, canonicalIssue159Release(release), key, signature),
    "INDEPENDENT_RELEASE_SIGNATURE_INVALID");

  const work = {
    commandId: release.commandId,
    eventId: release.eventId,
    challenge: release.challenge,
    correlationId: release.correlationId,
    accountAlias: "GPT02",
    workerId: WORKER,
    ownerChannel: release.ownerChannel,
    targetConversationId: release.targetConversationId,
    devOnly: true,
    instruction: held.instruction,
  };
  validateJob(work, binding);
  return Object.freeze({
    environment: "DEV",
    stage: "SIGNED_RELEASE_READY_FOR_SEPARATELY_AUTHORIZED_TRANSPORT",
    work: Object.freeze(work),
    // A cryptographic release proof is still not a DB one-use fence, a
    // live principal lookup, a browser send or Final ACK.
    oneUseDatabaseFenceVerified: false,
    liveGatewayPrincipalVerified: false,
    workerCommandSent: false,
    finalAckVerified: false,
    dispatchPermitted: false,
    releaseDecision: "NO_GO",
  });
}

function protectedRootFile(path) {
  const stat = lstatSync(path);
  requireOk(stat.isFile() && !stat.isSymbolicLink() &&
    stat.uid === 0 && stat.gid === 0 &&
    (stat.mode & 0o022) === 0, "RELEASE_PINNED_ROOT_CUSTODY_INVALID");
  return readFileSync(path, { encoding: "utf8" });
}
/**
 * The only intended operational entrypoint: the release public key
 * is always read from the system-controlled DEV trust directory.
 * The four existing signer keys do NOT stand in for this independent
 * release authority. No release private key is stored in this module.
 * On current live DEV these files are deliberately not installed.
 */
export function verifyIssue159ReleaseUsingPinnedRoot(input) {
  const dir = dirname(PINNED_PUBLIC_ROOT);
  requireOk(dirname(PINNED_ROOT_FINGERPRINT) === dir,
    "RELEASE_PINNED_DIRECTORY_MISMATCH");
  let pem, pinnedSha;
  try {
    const parent = lstatSync(dir);
    requireOk(parent.isDirectory() && !parent.isSymbolicLink() &&
      parent.uid === 0 && parent.gid === 0 &&
      (parent.mode & 0o022) === 0, "RELEASE_PINNED_DIRECTORY_INVALID");
    pem = protectedRootFile(PINNED_PUBLIC_ROOT);
    pinnedSha = protectedRootFile(PINNED_ROOT_FINGERPRINT).trim();
  } catch {
    throw new BridgeViolation("RELEASE_INDEPENDENT_PINNED_ROOT_UNAVAILABLE");
  }
  requireOk(HEX.test(pinnedSha), "RELEASE_PINNED_FINGERPRINT_INVALID");
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new BridgeViolation("RELEASE_PINNED_PUBLIC_KEY_INVALID");
  }
  requireOk(key.asymmetricKeyType === "ed25519",
    "RELEASE_PINNED_KEY_NOT_ED25519");
  const der = key.export({ type: "spki", format: "der" });
  requireOk(createHash("sha256").update(der).digest("hex") === pinnedSha,
    "RELEASE_PINNED_FINGERPRINT_MISMATCH");
  return verifyIssue159ReleaseCandidate({
    ...input, publicKeyPem: pem,
  });
}
