import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import {
  chmodSync, chownSync, lstatSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHash, createPublicKey, generateKeyPairSync, sign,
} from "node:crypto";
import {
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
} from "../gpt02Issue159FourSignerContract.js";
import {
  readGpt02Issue159HubCoreTrustedFacts,
  readGpt02Issue159HubCoreTrustedFactsFromSystemdCredentials,
} from "../gpt02Issue159HubCoreTrustedReader.js";

const worker = "openclaw-dell-chatgpt-wake-dev";
const uuid = {
  command: "11111111-1111-4111-8111-111111111111",
  attempt: "22222222-2222-4222-8222-222222222222",
  link: "33333333-3333-4333-8333-333333333333",
  execution: "44444444-4444-4444-8444-444444444444",
  coreTask: "55555555-5555-4555-8555-555555555555",
};
const keys = {
  approval: generateKeyPairSync("ed25519"),
  hub: generateKeyPairSync("ed25519"),
  core: generateKeyPairSync("ed25519"),
  issuer: generateKeyPairSync("ed25519"),
};
const pem = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) =>
  key.export({ format: "pem", type: "spki" }).toString();
const publicKeys = {
  approval: pem(keys.approval.publicKey),
  hub: pem(keys.hub.publicKey),
  core: pem(keys.core.publicKey),
};

function fixture() {
  const observedAt = Date.now();
  const approval = {
    v: 2,
    environment: "DEV",
    audience: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
    taskId: 137,
    commandId: uuid.command,
    attemptId: uuid.attempt,
    nonce: "A".repeat(44),
    operatorNamespace: "ai-task-hub.public.users",
    superAdminId: "fixture-super-admin",
    companyId: "default",
    issuedAt: observedAt - 5000,
    expiresAt: observedAt + 60_000,
  };
  const approvalDigest = createHash("sha256")
    .update(canonicalGpt02Issue159Approval(approval)).digest("hex");
  const link = {
    v: 1,
    environment: "DEV",
    audience: "GPT02_DUAL_ACCOUNT_COMMAND_LINK",
    linkId: uuid.link,
    companyId: "default",
    hubTaskId: 137,
    hubExecutionId: uuid.execution,
    coreTaskId: uuid.coreTask,
    coreCommandId: uuid.command,
    attemptId: uuid.attempt,
    attemptNumber: 1,
    assigneeId: 5,
    accountableOwnerId: "fixture-owner",
    hubOperatorNamespace: "ai-task-hub.public.users",
    hubOperatorId: approval.superAdminId,
    hubRole: "super_admin",
    hubActive: true,
    coreOperatorNamespace: "ai-core.ai_platform.internal_users",
    coreOperatorUserId: 77,
    coreRole: "admin",
    coreActive: true,
    corePasswordChanged: true,
    workerId: worker,
    approvalDigest,
    nonce: approval.nonce,
    issuedAt: observedAt - 4000,
    expiresAt: observedAt + 50_000,
  };
  const linkDigest = createHash("sha256")
    .update(canonicalGpt02Issue159OperatorLink(link)).digest("hex");
  const approvalSignatureBase64url = sign(
    null,
    Buffer.from(canonicalGpt02Issue159Approval(approval)),
    keys.approval.privateKey,
  ).toString("base64url");
  const hubSignatureBase64url = sign(
    null,
    Buffer.from("GPT02_OPERATOR_LINK_V1:hub\n" + canonicalGpt02Issue159OperatorLink(link)),
    keys.hub.privateKey,
  ).toString("base64url");
  const coreSignatureBase64url = sign(
    null,
    Buffer.from("GPT02_OPERATOR_LINK_V1:core\n" + canonicalGpt02Issue159OperatorLink(link)),
    keys.core.privateKey,
  ).toString("base64url");

  const facts = {
    prepared: {
      companyId: "default",
      hubTaskId: 137,
      memberId: 5,
      memberAuditId: 4567,
      operatorSubject: approval.superAdminId,
      coreTaskId: uuid.coreTask,
      hubExecutionId: uuid.execution,
      commandCandidateId: uuid.command,
      attemptId: uuid.attempt,
      expiresAt: observedAt + 45_000,
    },
    job: {
      companyId: "default",
      taskId: 137,
      executionId: uuid.execution,
      status: "prepared",
      commandId: null,
      workerCommandCount: 0,
      attemptNumber: 1,
      dispatchStarted: false,
      memberId: 5,
      memberAuditId: 4567,
      operatorSubject: approval.superAdminId,
    },
    core: {
      taskId: uuid.coreTask,
      commandCandidateId: uuid.command,
      attemptId: uuid.attempt,
      status: "PENDING",
      commandCount: 0,
      runCount: 0,
      workerId: worker,
      operatorUserId: 77,
      operatorRole: "admin",
      operatorActive: true,
      passwordChanged: true,
    },
    hubOperator: {
      subject: approval.superAdminId,
      role: "super_admin",
      active: true,
      memberId: 5,
      accountableOwnerId: "fixture-owner",
    },
    hubAssignment: {
      action: "gpt02_pic_assigned",
      entityId: "137",
      actorId: approval.superAdminId,
      actorRole: "super_admin",
      actorActive: true,
    },
    storedEvidence: {
      approval: {
        claims: approval,
        signatureBase64url: approvalSignatureBase64url,
        digest: approvalDigest,
      },
      operatorLink: {
        claims: link,
        linkDigest,
        hubSignatureBase64url,
        coreSignatureBase64url,
      },
    },
    observedAt,
    trustedReadProof: {
      source: "gpt02-issue159-reader",
      environment: "DEV",
      hubRole: "gpt02_hub_evidence_reader",
      coreRole: "gpt02_core_evidence_reader",
      separateBackends: true,
      clientTlsVerified: true,
      readOnly: true,
      dispatchPermitted: false,
      signingPermitted: false,
    },
  };
  const query = {
    companyId: "default",
    hubTaskId: 137,
    commandCandidateId: uuid.command,
    attemptId: uuid.attempt,
    linkId: uuid.link,
    linkDigest,
    approvalDigest,
  };
  return { facts, query };
}

async function socketFixture(
  facts: Record<string, unknown>,
  patch: { healthStatus?: number; factStatus?: number; healthPatch?: Record<string, unknown> } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "gpt02-hub-core-reader-"));
  chownSync(dir, process.getuid!(), process.getgid!());
  chmodSync(dir, 0o2750);
  const socketPath = join(dir, "reader.sock");
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      const value = Buffer.from(JSON.stringify(body));
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": String(value.length),
      });
      res.end(value);
    };
    if (req.method === "GET" && req.url === "/health") {
      send(patch.healthStatus ?? 200, {
        ok: true,
        environment: "DEV",
        readerReady: true,
        hubRole: "gpt02_hub_evidence_reader",
        coreRole: "gpt02_core_evidence_reader",
        twoSessionsVerified: true,
        signingPermitted: false,
        dispatchPermitted: false,
        ...(patch.healthPatch ?? {}),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/trusted-facts") {
      send(patch.factStatus ?? 200, {
        ok: true,
        environment: "DEV",
        facts,
        signingPermitted: false,
        dispatchPermitted: false,
      });
      return;
    }
    send(404, { ok: false });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  chownSync(socketPath, process.getuid!(), process.getgid!());
  chmodSync(socketPath, 0o660);
  return {
    socketPath,
    signerGroupGid: process.getgid!(),
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("GPT02 Issue159 Hub/Core persisted trusted reader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads exact persisted facts, verifies all three signatures and keeps NO-GO", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { facts, query } = fixture();
    const socket = await socketFixture(facts);
    try {
      const result = await readGpt02Issue159HubCoreTrustedFacts({
        query, publicKeys, socketPath: socket.socketPath,
        signerGroupGid: socket.signerGroupGid,
      });
      expect(result.environment).toBe("DEV");
      expect(result.persistedTrustedReadProven).toBe(true);
      expect(result.approvalSignatureVerified).toBe(true);
      expect(result.hubSignatureVerified).toBe(true);
      expect(result.coreSignatureVerified).toBe(true);
      expect(result.hubAuthorizer.operatorBindingMatched).toBe(true);
      expect(result.coreAuthorizer.operatorBindingMatched).toBe(true);
      expect(result.signingPermitted).toBe(false);
      expect(result.authorizationGranted).toBe(false);
      expect(result.dispatchPermitted).toBe(false);
      expect(result.releaseDecision).toBe("NO_GO");
    } finally {
      await socket.close();
    }
  });



  it("loads all public roots from systemd credentials for the production reader entry point", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { facts, query } = fixture();
    const socket = await socketFixture(facts);
    const credentials = mkdtempSync(join(tmpdir(), "gpt02-signer-public-creds-"));
    try {
      const names = {
        approval: "approval-public.pem",
        hub: "hub-identity-public.pem",
        core: "core-identity-public.pem",
        issuer: "issuer-public.pem",
      };
      const manifest: Record<string, string> = {};
      for (const role of ["approval", "hub", "core", "issuer"] as const) {
        const publicKeyPem = pem(keys[role].publicKey);
        writeFileSync(join(credentials, names[role]), publicKeyPem, { mode: 0o600 });
        chmodSync(join(credentials, names[role]), 0o600);
        const key = createPublicKey(publicKeyPem);
        manifest[role] = createHash("sha256")
          .update(key.export({ format: "der", type: "spki" })).digest("hex");
      }
      writeFileSync(join(credentials, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
      chmodSync(join(credentials, "manifest.json"), 0o600);
      vi.stubEnv("CREDENTIALS_DIRECTORY", credentials);
      const result = await readGpt02Issue159HubCoreTrustedFactsFromSystemdCredentials({
        query, socketPath: socket.socketPath, signerGroupGid: socket.signerGroupGid,
      });
      expect(result.publicRootsVerified).toBe(true);
      expect(result.approvalSignatureVerified).toBe(true);
      expect(result.hubSignatureVerified).toBe(true);
      expect(result.coreSignatureVerified).toBe(true);
      expect(result.persistedTrustedReadProven).toBe(true);
      expect(result.signingPermitted).toBe(false);
    } finally {
      await socket.close();
      rmSync(credentials, { recursive: true, force: true });
    }
  });

  it("rejects invalid health proof before reading business facts", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { facts, query } = fixture();
    const socket = await socketFixture(facts, { healthPatch: { twoSessionsVerified: false } });
    try {
      await expect(readGpt02Issue159HubCoreTrustedFacts({
        query, publicKeys, socketPath: socket.socketPath,
        signerGroupGid: socket.signerGroupGid,
      })).rejects.toThrow("GPT02_HUB_CORE_READER_HEALTH_NOT_TRUSTED");
    } finally {
      await socket.close();
    }
  });

  it("rejects a modified detached signature", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { facts, query } = fixture();
    const evidence = facts.storedEvidence as Record<string, any>;
    evidence.operatorLink.hubSignatureBase64url = "A".repeat(86);
    const socket = await socketFixture(facts);
    try {
      await expect(readGpt02Issue159HubCoreTrustedFacts({
        query, publicKeys, socketPath: socket.socketPath,
        signerGroupGid: socket.signerGroupGid,
      })).rejects.toThrow("GPT02_HUB_CORE_DETACHED_SIGNATURE_INVALID");
    } finally {
      await socket.close();
    }
  });

  it("rejects wrong signer socket group or world-readable socket", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { facts, query } = fixture();
    const socket = await socketFixture(facts);
    try {
      await expect(readGpt02Issue159HubCoreTrustedFacts({
        query, publicKeys, socketPath: socket.socketPath,
        signerGroupGid: socket.signerGroupGid + 1,
      })).rejects.toThrow("GPT02_TRUSTED_READER_SOCKET_SECURITY_INVALID");
      chmodSync(socket.socketPath, 0o666);
      await expect(readGpt02Issue159HubCoreTrustedFacts({
        query, publicKeys, socketPath: socket.socketPath,
        signerGroupGid: socket.signerGroupGid,
      })).rejects.toThrow("GPT02_TRUSTED_READER_SOCKET_SECURITY_INVALID");
    } finally {
      await socket.close();
    }
  });
});
