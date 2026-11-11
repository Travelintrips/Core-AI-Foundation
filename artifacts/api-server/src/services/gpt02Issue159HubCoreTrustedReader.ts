import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { dirname } from "node:path";
import {
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
  verifyGpt02Issue159Signature,
} from "./gpt02Issue159FourSignerContract.js";
import {
  inspectGpt02Issue159OperatorAuthorizerEvidence,
} from "./gpt02Issue159OperatorAuthorizerEvidence.js";
import {
  readGpt02Issue159PublicCredentials,
} from "./gpt02Issue159PublicCredentialReader.js";

const DEFAULT_SOCKET = "/run/gpt02-reader/reader.sock";
const SIGNER_GROUP = "gpt02-issue159-signers";
const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;

type RecordValue = Record<string, unknown>;
type Query = {
  companyId: string;
  hubTaskId: number;
  commandCandidateId: string;
  attemptId: string;
  linkId: string;
  linkDigest: string;
  approvalDigest: string;
};
type PublicKeys = { approval: string; hub: string; core: string };

const fail = (code: string): never => {
  const error = new Error(code);
  error.name = "Gpt02HubCoreTrustedReaderError";
  throw error;
};

function exactObject(value: unknown, fields: readonly string[]): value is RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as RecordValue).sort();
  return keys.join(",") === [...fields].sort().join(",");
}

function validQuery(value: unknown): value is Query {
  if (!exactObject(value, [
    "companyId", "hubTaskId", "commandCandidateId", "attemptId",
    "linkId", "linkDigest", "approvalDigest",
  ])) return false;
  const q = value as Query;
  return q.companyId === "default" &&
    Number.isSafeInteger(q.hubTaskId) && q.hubTaskId > 136 &&
    [q.commandCandidateId, q.attemptId, q.linkId].every(x => UUID.test(String(x))) &&
    new Set([q.commandCandidateId, q.attemptId, q.linkId]).size === 3 &&
    HEX.test(q.linkDigest) && HEX.test(q.approvalDigest);
}

function resolveSignerGroupGid(): number {
  const line = readFileSync("/etc/group", "utf8")
    .split(/\r?\n/).find(value => value.startsWith(SIGNER_GROUP + ":"));
  if (!line) return fail("GPT02_SIGNER_READER_GROUP_REQUIRED");
  const gid = Number(line.split(":")[2]);
  if (!Number.isSafeInteger(gid) || gid <= 0) {
    return fail("GPT02_SIGNER_READER_GROUP_INVALID");
  }
  return gid;
}

function assertReaderSocket(socketPath: string, signerGroupGid: number): void {
  let directory;
  let socket;
  const parentPath = socketPath === DEFAULT_SOCKET ? "/run/gpt02-reader" : dirname(socketPath);
  try {
    directory = lstatSync(parentPath);
    socket = lstatSync(socketPath);
  } catch {
    return fail("GPT02_TRUSTED_READER_SOCKET_REQUIRED");
  }
  if (socketPath !== DEFAULT_SOCKET ||
      !directory.isDirectory() || directory.uid === 0 ||
      directory.gid !== signerGroupGid ||
      (directory.mode & 0o7777) !== 0o2750 ||
      !socket.isSocket() || socket.uid === 0 ||
      socket.gid !== signerGroupGid ||
      (socket.mode & 0o777) !== 0o660) {
    return fail("GPT02_TRUSTED_READER_SOCKET_SECURITY_INVALID");
  }
}

async function requestReader(
  socketPath: string,
  method: "GET" | "POST",
  url: "/health" | "/trusted-facts",
  body?: unknown,
): Promise<{ status: number; body: RecordValue }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      socketPath,
      path: url,
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", chunk => {
        const value = Buffer.from(chunk);
        bytes += value.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("GPT02_TRUSTED_READER_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(value);
      });
      response.on("end", () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reject(new Error("GPT02_TRUSTED_READER_RESPONSE_INVALID"));
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("GPT02_TRUSTED_READER_RESPONSE_INVALID"));
          return;
        }
        resolve({ status: response.statusCode ?? 0, body: parsed as RecordValue });
      });
      response.on("error", () => reject(new Error("GPT02_TRUSTED_READER_RESPONSE_FAILED")));
    });
    req.setTimeout(10_000, () => req.destroy(new Error("GPT02_TRUSTED_READER_TIMEOUT")));
    req.on("error", () => reject(new Error("GPT02_TRUSTED_READER_UNAVAILABLE")));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function requirePublicKeys(value: unknown): asserts value is PublicKeys {
  if (!exactObject(value, ["approval", "hub", "core"]) ||
      !["approval", "hub", "core"].every(key =>
        typeof (value as RecordValue)[key] === "string" &&
        String((value as RecordValue)[key]).length >= 100 &&
        String((value as RecordValue)[key]).length <= 2048)) {
    fail("GPT02_FOUR_PUBLIC_VERIFIER_KEYS_REQUIRED");
  }
}

/**
 * Reads the exact Hub/Core persisted evidence through the signer-group-only
 * Unix socket. It validates the reader's live health, task binding, stored
 * approval/link signatures, and both operator identities. It never signs,
 * consumes a nonce, writes evidence, creates a task, or dispatches.
 */
export async function readGpt02Issue159HubCoreTrustedFacts(input: {
  query: unknown;
  publicKeys: unknown;
  socketPath?: string;
  signerGroupGid?: number;
}) {
  if (!exactObject(input, ["query", "publicKeys", "socketPath", "signerGroupGid"]) &&
      !exactObject(input, ["query", "publicKeys"])) {
    fail("GPT02_HUB_CORE_TRUSTED_READER_INPUT_INVALID");
  }
  if (!validQuery(input.query)) fail("GPT02_UNTRUSTED_TASK_IDENTITY");
  requirePublicKeys(input.publicKeys);
  const synthetic = process.env.NODE_ENV === "test";
  const socketPath = synthetic ? (input.socketPath ?? DEFAULT_SOCKET) : DEFAULT_SOCKET;
  const signerGroupGid = synthetic
    ? (input.signerGroupGid ?? process.getgid())
    : resolveSignerGroupGid();
  if (!Number.isSafeInteger(signerGroupGid) || signerGroupGid <= 0) {
    fail("GPT02_SIGNER_READER_GROUP_INVALID");
  }
  assertReaderSocket(socketPath, signerGroupGid);

  const health = await requestReader(socketPath, "GET", "/health");
  if (health.status !== 200 || health.body.ok !== true ||
      health.body.environment !== "DEV" ||
      health.body.readerReady !== true ||
      health.body.hubRole !== "gpt02_hub_evidence_reader" ||
      health.body.coreRole !== "gpt02_core_evidence_reader" ||
      health.body.twoSessionsVerified !== true ||
      health.body.signingPermitted !== false ||
      health.body.dispatchPermitted !== false) {
    fail("GPT02_HUB_CORE_READER_HEALTH_NOT_TRUSTED");
  }

  const response = await requestReader(socketPath, "POST", "/trusted-facts", input.query);
  if (response.status !== 200 || response.body.ok !== true ||
      response.body.environment !== "DEV" ||
      response.body.signingPermitted !== false ||
      response.body.dispatchPermitted !== false) {
    fail("GPT02_HUB_CORE_TRUSTED_READ_FAILED");
  }

  const facts = response.body.facts;
  if (!exactObject(facts, [
    "prepared", "job", "core", "hubOperator", "hubAssignment",
    "storedEvidence", "observedAt", "trustedReadProof",
  ])) fail("GPT02_HUB_CORE_FACTS_SHAPE_INVALID");

  const proof = facts.trustedReadProof as RecordValue;
  if (!exactObject(proof, [
    "source", "environment", "hubRole", "coreRole", "separateBackends",
    "clientTlsVerified", "readOnly", "dispatchPermitted", "signingPermitted",
  ]) || proof.source !== "gpt02-issue159-reader" ||
      proof.environment !== "DEV" ||
      proof.hubRole !== "gpt02_hub_evidence_reader" ||
      proof.coreRole !== "gpt02_core_evidence_reader" ||
      proof.separateBackends !== true || proof.clientTlsVerified !== true ||
      proof.readOnly !== true || proof.dispatchPermitted !== false ||
      proof.signingPermitted !== false) {
    fail("GPT02_HUB_CORE_PERSISTED_READ_PROOF_INVALID");
  }

  const observedAt = facts.observedAt as number;
  if (!Number.isSafeInteger(observedAt) || Number(observedAt) <= 0 ||
      !exactObject(facts.prepared, [
        "companyId", "hubTaskId", "memberId", "memberAuditId",
        "operatorSubject", "coreTaskId", "hubExecutionId",
        "commandCandidateId", "attemptId", "expiresAt",
      ]) ||
      !exactObject(facts.job, [
        "companyId", "taskId", "executionId", "status", "commandId",
        "workerCommandCount", "attemptNumber", "dispatchStarted",
        "memberId", "memberAuditId", "operatorSubject",
      ]) ||
      !exactObject(facts.core, [
        "taskId", "commandCandidateId", "attemptId", "status",
        "commandCount", "runCount", "workerId", "operatorUserId",
        "operatorRole", "operatorActive", "passwordChanged",
      ]) ||
      !exactObject(facts.hubOperator, [
        "subject", "role", "active", "memberId", "accountableOwnerId",
      ]) ||
      !exactObject(facts.hubAssignment, [
        "action", "entityId", "actorId", "actorRole", "actorActive",
      ]) ||
      !exactObject(facts.storedEvidence, ["approval", "operatorLink"])) {
    fail("GPT02_HUB_CORE_FACT_BINDING_INVALID");
  }

  const stored = facts.storedEvidence as RecordValue;
  const approval = stored.approval as RecordValue;
  const link = stored.operatorLink as RecordValue;
  if (!exactObject(approval, ["claims", "signatureBase64url", "digest"]) ||
      !exactObject(link, [
        "claims", "linkDigest", "hubSignatureBase64url", "coreSignatureBase64url",
      ])) {
    fail("GPT02_HUB_CORE_STORED_EVIDENCE_SHAPE_INVALID");
  }

  const q = input.query;
  const prepared = facts.prepared as RecordValue;
  const job = facts.job as RecordValue;
  const core = facts.core as RecordValue;
  const hub = facts.hubOperator as RecordValue;
  const assignment = facts.hubAssignment as RecordValue;
  const approvalClaims = approval.claims;
  const linkClaims = link.claims as RecordValue;
  const keys = input.publicKeys as PublicKeys;
  if (!exactObject(approvalClaims, [
    "v", "environment", "audience", "taskId", "commandId", "attemptId",
    "nonce", "operatorNamespace", "superAdminId", "companyId", "issuedAt", "expiresAt",
  ]) ||
      prepared.companyId !== q.companyId ||
      prepared.hubTaskId !== q.hubTaskId ||
      prepared.commandCandidateId !== q.commandCandidateId ||
      prepared.attemptId !== q.attemptId ||
      prepared.coreTaskId !== core.taskId ||
      prepared.hubExecutionId !== linkClaims.hubExecutionId ||
      prepared.coreTaskId !== linkClaims.coreTaskId ||
      prepared.memberId !== hub.memberId ||
      prepared.hubExecutionId === "" ||
      !Number.isSafeInteger(prepared.expiresAt) ||
      observedAt > Number(prepared.expiresAt) ||
      link.linkDigest !== q.linkDigest ||
      approval.digest !== q.approvalDigest ||
      approvalClaims.taskId !== q.hubTaskId ||
      approvalClaims.commandId !== q.commandCandidateId ||
      approvalClaims.attemptId !== q.attemptId ||
      approvalClaims.companyId !== q.companyId ||
      approvalClaims.superAdminId !== hub.subject ||
      job.companyId !== q.companyId ||
      job.taskId !== q.hubTaskId ||
      job.executionId !== prepared.hubExecutionId ||
      job.status !== "prepared" ||
      job.commandId !== null ||
      job.workerCommandCount !== 0 ||
      job.attemptNumber !== 1 ||
      job.dispatchStarted !== false ||
      job.memberId !== prepared.memberId ||
      job.memberAuditId !== prepared.memberAuditId ||
      job.operatorSubject !== prepared.operatorSubject) {
    fail("GPT02_HUB_CORE_REQUEST_BINDING_MISMATCH");
  }

  let approvalDigest: string;
  let linkDigest: string;
  try {
    approvalDigest = createHash("sha256")
      .update(canonicalGpt02Issue159Approval(approvalClaims)).digest("hex");
    linkDigest = createHash("sha256")
      .update(canonicalGpt02Issue159OperatorLink(linkClaims)).digest("hex");
  } catch {
    fail("GPT02_HUB_CORE_CANONICAL_EVIDENCE_INVALID");
  }
  if (approvalDigest !== q.approvalDigest ||
      approval.digest !== approvalDigest ||
      linkDigest !== q.linkDigest ||
      link.linkDigest !== linkDigest ||
      linkClaims.linkId !== q.linkId ||
      linkClaims.approvalDigest !== approvalDigest) {
    fail("GPT02_HUB_CORE_STORED_DIGEST_MISMATCH");
  }

  const approvalSignatureVerified = verifyGpt02Issue159Signature(
    "approval", approvalClaims, String(approval.signatureBase64url),
    keys.approval,
  );
  const hubSignatureVerified = verifyGpt02Issue159Signature(
    "hub", linkClaims, String(link.hubSignatureBase64url), keys.hub,
  );
  const coreSignatureVerified = verifyGpt02Issue159Signature(
    "core", linkClaims, String(link.coreSignatureBase64url), keys.core,
  );
  if (!approvalSignatureVerified || !hubSignatureVerified || !coreSignatureVerified) {
    fail("GPT02_HUB_CORE_DETACHED_SIGNATURE_INVALID");
  }

  const claimsSha256 = linkDigest;
  const hubEvidence = {
    namespace: "ai-task-hub.public.users",
    operatorId: hub.subject,
    operatorRole: hub.role,
    active: hub.active,
    hubTaskId: prepared.hubTaskId,
    hubExecutionId: prepared.hubExecutionId,
    commandCandidateId: prepared.commandCandidateId,
    attemptId: prepared.attemptId,
    linkId: linkClaims.linkId,
    assignmentAuditAction: assignment.action,
    assignmentAuditEntityId: assignment.entityId,
    assignmentActorId: assignment.actorId,
    assignmentActorRole: assignment.actorRole,
    assignmentActorActive: assignment.actorActive,
    approvalDigest,
    claimsSha256,
    observedAt,
  };
  const coreEvidence = {
    namespace: "ai-core.ai_platform.internal_users",
    operatorUserId: core.operatorUserId,
    operatorRole: core.operatorRole,
    active: core.operatorActive,
    passwordChanged: core.passwordChanged,
    coreTaskId: core.taskId,
    coreCommandId: core.commandCandidateId,
    attemptId: core.attemptId,
    taskStatus: core.status,
    runCount: core.runCount,
    commandCount: core.commandCount,
    workerId: core.workerId,
    linkId: linkClaims.linkId,
    claimsSha256,
    observedAt,
  };

  const hubAuthorizer = inspectGpt02Issue159OperatorAuthorizerEvidence({
    role: "hub", claims: linkClaims, evidence: hubEvidence, observedAt,
  });
  const coreAuthorizer = inspectGpt02Issue159OperatorAuthorizerEvidence({
    role: "core", claims: linkClaims, evidence: coreEvidence, observedAt,
  });

  return Object.freeze({
    environment: "DEV" as const,
    query: Object.freeze({ ...q }),
    observedAt,
    trustedReadProof: Object.freeze({ ...proof }),
    approvalSignatureVerified,
    hubSignatureVerified,
    coreSignatureVerified,
    hubAuthorizer,
    coreAuthorizer,
    facts,
    persistedTrustedReadProven: true as const,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    releaseDecision: "NO_GO" as const,
  });
}


/**
 * Production entry point for signer services. Public roots are read only
 * from systemd LoadCredential mounts; callers cannot inject public keys.
 */
export async function readGpt02Issue159HubCoreTrustedFactsFromSystemdCredentials(input: {
  query: unknown;
  socketPath?: string;
  signerGroupGid?: number;
}) {
  const roots = readGpt02Issue159PublicCredentials();
  return readGpt02Issue159HubCoreTrustedFacts({
    query: input.query,
    publicKeys: {
      approval: roots.approvalPublicKeyPem,
      hub: roots.hubPublicKeyPem,
      core: roots.corePublicKeyPem,
    },
    ...(input.socketPath === undefined ? {} : { socketPath: input.socketPath }),
    ...(input.signerGroupGid === undefined ? {} : { signerGroupGid: input.signerGroupGid }),
  });
}
