import { createHash, generateKeyPairSync, sign } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authenticated = vi.hoisted(() => ({
  enabled: true,
  tokenHash: "a".repeat(64),
  name: "openclaw-vps-dev-consumer",
  requiredScope: "",
  calls: 0,
}));
const fixtureFs = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn() }));
const runtimeBoundary = vi.hoisted(() => ({ databaseGuard: vi.fn(), readPresence: vi.fn() }));
vi.mock("node:fs/promises", () => fixtureFs);
vi.mock("../../middleware/agentServiceAuth.js", () => ({
  // Test-only authentication boundary. Production still performs active/expiry/
  // scope checks against its canonical service-token table.
  requireAgentServiceScope: (scope: string, binding: (hash: string) => string) => {
    authenticated.requiredScope = scope;
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      authenticated.calls += 1;
      if (!authenticated.enabled || req.get("Authorization") !== "Bearer fixture-worker") {
        res.status(401).json({ error: "INVALID_SERVICE_TOKEN" });
        return;
      }
      res.locals.aiAgentService = {
        id: "8ad7fba1-d2e3-4f51-8a13-68d1eaf71d50",
        name: authenticated.name,
        scopes: ["agent:presence"],
        credentialBinding: binding(authenticated.tokenHash),
      };
      next();
    };
  },
}));
vi.mock("../../services/externalAgentRegistryService.js", () => ({
  getExternalAgentRule: () => ({
    role: "bounded_orchestration_agent",
    capabilities: ["gpt02:reader-custody:coordinate:dev"],
    permissions: { productionDeploy: false, gitPush: false, gitCommit: false },
  }),
  getExternalAgentRegistrySnapshot: runtimeBoundary.readPresence,
}));
vi.mock("@workspace/db", () => ({
  assertDevelopmentDatabaseIsolation: runtimeBoundary.databaseGuard,
  pool: { options: { connectionString: "postgresql://fixture.invalid:1/postgres" } },
}));

import { createGpt02ReaderCustodyBroker, createLockedGpt02ReaderCustodyBroker } from "../gpt02-reader-custody-broker.js";
import {
  createGpt02ReaderCustodyRuntime,
  CustodyFileError,
  GPT02_CUSTODY_FILES,
} from "../../services/gpt02ReaderCustodyVerifiedAdapter.js";
import {
  GPT02_DBA_CUSTODY_TARGET,
  GPT02_WORKER_ATTESTATION_TARGET,
  gpt02CustodyCredentialBinding,
} from "../../services/gpt02ReaderCustodyAttestation.js";

const now = Date.UTC(2026, 10, 24, 12);
const serviceId = "8ad7fba1-d2e3-4f51-8a13-68d1eaf71d50";
const receiptId = "1eaf4224-b999-4e13-80e2-3fc648525982";
const url = "/api/gpt02-reader-custody";
const auth = { Authorization: "Bearer fixture-worker" };

function pair() {
  const result = generateKeyPairSync("ed25519");
  const der = result.publicKey.export({ type: "spki", format: "der" });
  return { ...result, der: der.toString("base64"), fingerprint: createHash("sha256").update(der).digest("hex") };
}

function makeApp() {
  const workerKey = pair();
  const dbaKey = pair();
  const binding = gpt02CustodyCredentialBinding("a".repeat(64));
  const workerReceipt = {
    ...GPT02_WORKER_ATTESTATION_TARGET,
    credentialId: serviceId,
    credentialBinding: binding,
    issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
    notBefore: now - 1000,
    expiresAt: now + 60_000,
  };
  const dbaReceipt = {
    ...GPT02_DBA_CUSTODY_TARGET,
    credentialId: serviceId,
    credentialBinding: binding,
    workerAttestationSha256: createHash("sha256").update(JSON.stringify(workerReceipt)).digest("hex"),
    receiptId,
    notBefore: now,
    expiresAt: now + 30_000,
  };
  const documents: Record<"worker" | "dba", unknown> = {
    worker: {
      receipt: workerReceipt,
      signature: sign(null, Buffer.from(JSON.stringify(workerReceipt)), workerKey.privateKey).toString("base64url"),
    },
    dba: {
      receipt: dbaReceipt,
      signature: sign(null, Buffer.from(JSON.stringify(dbaReceipt)), dbaKey.privateKey).toString("base64url"),
    },
  };
  const env: NodeJS.ProcessEnv = {
    APP_ENV: "development", NODE_ENV: "test",
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64: workerKey.der,
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256: workerKey.fingerprint,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64: dbaKey.der,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256: dbaKey.fingerprint,
  };
  let clock = now;
  const readDocument = vi.fn(async (kind: "worker" | "dba") => documents[kind]);
  const inspectReaderMount = vi.fn(async () => undefined);
  const readPresence = vi.fn(async () => ({ active: true, healthy: true }));
  const runtime = createGpt02ReaderCustodyRuntime({
    environment: () => env,
    now: () => clock,
    verifyDatabaseIsolation: () => undefined,
    readDocument,
    inspectReaderMount,
  });
  const app = express();
  app.use(express.json());
  app.use(url, createGpt02ReaderCustodyBroker({ ...runtime, readPresence }));
  return { app, env, documents, readDocument, inspectReaderMount, readPresence, setTime: (value: number) => { clock = value; } };
}

describe("HTTP custody broker with real signed evidence, isolated transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    authenticated.enabled = true;
    authenticated.tokenHash = "a".repeat(64);
    authenticated.name = "openclaw-vps-dev-consumer";
    authenticated.calls = 0;
    vi.clearAllMocks();
    runtimeBoundary.databaseGuard.mockReset();
    runtimeBoundary.readPresence.mockReset().mockResolvedValue([{
      clientId: "openclaw-vps-main", presenceState: "ACTIVE", reportedHealth: "healthy",
    }]);
  });

  it("the actual mounted factory uses signed filesystem evidence instead of permanent false stubs", async () => {
    const s = makeApp();
    for (const [key, value] of Object.entries(s.env)) vi.stubEnv(key, value!);
    vi.spyOn(Date, "now").mockReturnValue(now);
    fixtureFs.lstat.mockResolvedValue({
      uid: 0, mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false,
    });
    const credentialRead = vi.fn(() => { throw new Error("Credential contents must not be read"); });
    fixtureFs.open.mockImplementation(async (path: string) => {
      const reader = path === GPT02_CUSTODY_FILES.reader;
      const kind = path === GPT02_CUSTODY_FILES.worker ? "worker" : "dba";
      const bytes = reader ? Buffer.from("unread-fixture") : Buffer.from(JSON.stringify(s.documents[kind]));
      let position = 0;
      return {
        stat: async () => ({
          uid: 0, mode: 0o100600, nlink: 1, size: bytes.length, dev: 1, ino: 2,
          mtimeMs: 3, ctimeMs: 4, isFile: () => true,
        }),
        read: reader ? credentialRead : async (target: Buffer, offset: number, length: number) => {
          const count = Math.min(length, bytes.length - position);
          bytes.copy(target, offset, position, position + count);
          position += count;
          return { bytesRead: count, buffer: target };
        },
        close: async () => undefined,
      };
    });
    const app = express();
    app.use(express.json());
    app.use(url, createLockedGpt02ReaderCustodyBroker());
    const response = await request(app).get(url + "/status").set(auth);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: "CUSTODY_RECEIPT_VERIFIED", receiptId, readerE2eVerified: false });
    expect(fixtureFs.open.mock.calls.map(call => call[0])).toEqual([
      GPT02_CUSTODY_FILES.worker, GPT02_CUSTODY_FILES.worker, GPT02_CUSTODY_FILES.dba, GPT02_CUSTODY_FILES.reader,
    ]);
    expect(credentialRead).not.toHaveBeenCalled();
  });

  it("the mounted factory emits only an unsigned generation-bound request without an installed attestation", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64", undefined);
    vi.stubEnv("GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256", undefined);
    const app = express();
    app.use(url, createLockedGpt02ReaderCustodyBroker());
    const response = await request(app).get(url + "/attestation-request").set(auth);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      state: "AWAITING_AUTHORIZED_WORKER_ATTESTOR",
      unsignedRequest: {
        ...GPT02_WORKER_ATTESTATION_TARGET,
        credentialId: serviceId,
        credentialBinding: gpt02CustodyCredentialBinding("a".repeat(64)),
      },
      authorizationGranted: false,
      issuerAttestationVerified: false,
      credentialIssuedByBroker: false,
      signingPermitted: false,
      dispatchPermitted: false,
    });
    expect(response.body.unsignedRequest.credentialBinding).not.toBe(authenticated.tokenHash);
    expect(JSON.stringify(response.body)).not.toMatch(/fixture-worker|tokenHash|password|signature/i);
    expect(fixtureFs.open).not.toHaveBeenCalled();
    expect(fixtureFs.lstat).not.toHaveBeenCalled();
    // Obtaining the packet is not itself authorization for custody operations.
    const status = await request(app).get(url + "/status").set(auth);
    expect(status.status).toBe(403);
    expect(status.body.error).toBe("CUSTODY_ATTESTOR_NOT_CONFIGURED");
  });

  it("the mounted bootstrap factory refuses absent or different authenticated service identities", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("NODE_ENV", "test");
    const app = express();
    app.use(url, createLockedGpt02ReaderCustodyBroker());
    expect((await request(app).get(url + "/attestation-request")).status).toBe(401);
    authenticated.name = "gcp-ai-workers-primary";
    const wrong = await request(app).get(url + "/attestation-request").set(auth);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe("CUSTODY_WORKER_TOKEN_NOT_BOUND");
    expect(fixtureFs.open).not.toHaveBeenCalled();
  });

  it("the mounted bootstrap factory refuses non-DEV runtime before consulting receipt files", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NODE_ENV", "test");
    const app = express();
    app.use(url, createLockedGpt02ReaderCustodyBroker());
    const response = await request(app).get(url + "/attestation-request").set(auth);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "CUSTODY_DEV_RUNTIME_UNAVAILABLE" });
    expect(authenticated.calls).toBe(0);
    expect(runtimeBoundary.readPresence).not.toHaveBeenCalled();
    expect(fixtureFs.open).not.toHaveBeenCalled();
    expect(fixtureFs.lstat).not.toHaveBeenCalled();
  });

  it("the mounted factory rejects a wrong database before authentication, registry, or filesystem access", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("NODE_ENV", "test");
    runtimeBoundary.databaseGuard.mockImplementation(() => { throw new Error("untrusted-pool-private-details"); });
    const app = express();
    app.use(express.json());
    app.use(url, createLockedGpt02ReaderCustodyBroker());
    const responses = [
      await request(app).get(url + "/status").set(auth),
      await request(app).get(url + "/attestation-request").set(auth),
      await request(app).post(url + "/request").set(auth).send({ action: "VERIFY_NON_SECRET_READER_STATUS" }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "CUSTODY_DEV_RUNTIME_UNAVAILABLE" });
    }
    expect(runtimeBoundary.databaseGuard).toHaveBeenCalledTimes(3);
    expect(authenticated.calls).toBe(0);
    expect(runtimeBoundary.readPresence).not.toHaveBeenCalled();
    expect(fixtureFs.open).not.toHaveBeenCalled();
    expect(fixtureFs.lstat).not.toHaveBeenCalled();
  });

  it("reports the signed custody receipt without claiming reader E2E or execution", async () => {
    const s = makeApp();
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      state: "CUSTODY_RECEIPT_VERIFIED",
      receiptId,
      projectId: "xssrfshdrtdfupgqwfdw",
      worker: "openclaw-vps-main",
      readerE2eVerified: false,
      signingPermitted: false,
      dispatchPermitted: false,
      secretExposed: false,
      databaseMutationGranted: false,
    });
    expect(authenticated.requiredScope).toBe("agent:presence");
    expect(JSON.stringify(response.body)).not.toMatch(/credentialBinding|tokenHash|signature|privateKey|password|dsn/i);
    expect(s.inspectReaderMount).toHaveBeenCalledOnce();
  });

  it("does not record a handoff or issue credentials when an authorized request is inspected", async () => {
    const s = makeApp();
    const response = await request(s.app).post(url + "/request").set(auth).send({
      action: "REQUEST_AUTHORIZED_CUSTODIAN_PROVISIONING",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      state: "READY_FOR_READER_E2E_VERIFICATION",
      credentialIssuedByBroker: false,
      directPostgresPrivileges: false,
      requestRecorded: false,
      handoffDispatched: false,
      readerE2eVerified: false,
    });
  });

  it("requires authentication before consulting any receipt", async () => {
    const s = makeApp();
    const response = await request(s.app).get(url + "/status");
    expect(response.status).toBe(401);
    expect(s.readDocument).not.toHaveBeenCalled();
    expect(s.readPresence).not.toHaveBeenCalled();
  });

  it("honors credential revocation at the authentication boundary after an earlier success", async () => {
    const s = makeApp();
    expect((await request(s.app).get(url + "/status").set(auth)).status).toBe(200);
    s.readDocument.mockClear();
    authenticated.enabled = false;
    expect((await request(s.app).get(url + "/status").set(auth)).status).toBe(401);
    expect(s.readDocument).not.toHaveBeenCalled();
  });

  it("rejects reissued service credentials without changing their row ID", async () => {
    const s = makeApp();
    authenticated.tokenHash = "b".repeat(64);
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("CUSTODY_ATTESTATION_REJECTED");
    expect(s.inspectReaderMount).not.toHaveBeenCalled();
  });

  it("rejects a different authenticated service name", async () => {
    const s = makeApp();
    authenticated.name = "gcp-ai-workers-primary";
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("CUSTODY_WORKER_TOKEN_NOT_BOUND");
    expect(s.readDocument).not.toHaveBeenCalled();
  });

  it("explains absent trust configuration instead of a permanent stub denial", async () => {
    const s = makeApp();
    delete s.env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64;
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ state: "LOCKED", error: "CUSTODY_ATTESTOR_NOT_CONFIGURED" });
    expect(s.readDocument).not.toHaveBeenCalled();
    expect(s.readPresence).not.toHaveBeenCalled();
  });

  it("invalidates authorization when the worker receipt is removed between requests", async () => {
    const s = makeApp();
    expect((await request(s.app).get(url + "/status").set(auth)).status).toBe(200);
    s.readPresence.mockClear();
    s.readDocument.mockRejectedValue(new CustodyFileError("MISSING"));
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("CUSTODY_ATTESTATION_NOT_INSTALLED");
    expect(response.body.receiptId).toBeUndefined();
    expect(s.readPresence).not.toHaveBeenCalled();
  });

  it("refuses a proof that expires after its previous successful use", async () => {
    const s = makeApp();
    expect((await request(s.app).get(url + "/status").set(auth)).status).toBe(200);
    s.setTime(now + 60_000);
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("CUSTODY_ATTESTATION_REJECTED");
  });

  it.each([
    ["missing DBA receipt", "dba"],
    ["missing reader mount", "reader"],
  ])("keeps %s pending after valid worker attestation", async (_name, missing) => {
    const s = makeApp();
    if (missing === "dba") {
      s.readDocument.mockImplementation(async kind => {
        if (kind === "dba") throw new CustodyFileError("MISSING");
        return s.documents.worker;
      });
    } else {
      s.inspectReaderMount.mockRejectedValue(new CustodyFileError("MISSING"));
    }
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(200);
    expect(response.body.state).toBe("AWAITING_AUTHORIZED_DBA");
    expect(response.body.receiptId).toBeNull();
    expect(response.body.readerE2eVerified).toBe(false);
    expect(response.body.reason).toBe(missing === "dba" ? "CUSTODY_DBA_RECEIPT_NOT_INSTALLED" : "CUSTODY_READER_CREDENTIAL_NOT_MOUNTED");
    const mutation = await request(s.app).post(url + "/request").set(auth).send({ action: "VERIFY_SEALED_CUSTODY_RECEIPT" });
    expect(mutation.status).toBe(409);
    expect(mutation.body.credentialIssuedByBroker).toBe(false);
  });

  it.each([[false, true], [true, false]])("requires active and healthy independent registry presence (%s/%s)", async (active, healthy) => {
    const s = makeApp();
    s.readPresence.mockResolvedValue({ active, healthy });
    const response = await request(s.app).get(url + "/status").set(auth);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("CUSTODY_WORKER_PRESENCE_REQUIRED");
    expect(s.inspectReaderMount).not.toHaveBeenCalled();
  });

  it.each(["ALTER_ROLE_PASSWORD", "READ_CREDENTIAL", "ACTIVATE_SIGNER", "DEPLOY_PRODUCTION"])("rejects %s before evaluating proofs", async action => {
    const s = makeApp();
    const response = await request(s.app).post(url + "/request").set(auth).send({ action });
    expect(response.status).toBe(400);
    expect(s.readDocument).not.toHaveBeenCalled();
  });

  it("rejects an injected credential, principal, or receipt payload", async () => {
    const s = makeApp();
    const response = await request(s.app).post(url + "/request").set(auth).send({
      action: "VERIFY_NON_SECRET_READER_STATUS",
      canonicalPrincipal: "openclaw-vps-main",
      password: "test-only-forbidden-input",
      receipt: s.documents.dba,
    });
    expect(response.status).toBe(400);
    expect(s.readDocument).not.toHaveBeenCalled();
  });

  it("does not accept receipts through request query parameters", async () => {
    const s = makeApp();
    s.readDocument.mockRejectedValue(new CustodyFileError("MISSING"));
    const response = await request(s.app).get(url + "/status").set(auth).query({
      receipt: JSON.stringify(s.documents.worker),
      attestedBy: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
    });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("CUSTODY_ATTESTATION_NOT_INSTALLED");
  });
});
