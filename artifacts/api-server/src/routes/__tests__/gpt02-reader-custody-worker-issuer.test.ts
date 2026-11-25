import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authSelect: vi.fn(), transaction: vi.fn(), isolation: vi.fn(), readProtected: vi.fn(), logAudit: vi.fn(),
  writeFile: vi.fn(), rename: vi.fn(), unlink: vi.fn(), mkdir: vi.fn(),
  userTable: { id: "user.id", role: "user.role", status: "user.status", accountType: "user.accountType", mustChangePassword: "user.mustChangePassword" },
  tokenTable: { id: "token.id", name: "token.name", tokenHash: "token.hash", scopes: "token.scopes", isActive: "token.active", expiresAt: "token.expires" },
  auditTable: { id: "audit.id" },
}));
vi.mock("@workspace/db", () => ({
  db: { select: mocks.authSelect, transaction: mocks.transaction },
  pool: { options: { connectionString: "postgresql://synthetic-only/db" } },
  assertDevelopmentDatabaseIsolation: mocks.isolation,
  INTERNAL_ROLES: ["owner", "admin", "manager", "staff"],
  internalUsersTable: mocks.userTable, aiAgentServiceTokensTable: mocks.tokenTable, aiAuditLogsTable: mocks.auditTable,
}));
vi.mock("../../services/aiAuditService.js", () => ({ logAudit: mocks.logAudit }));
vi.mock("../../services/gpt02ProtectedRuntimeFile.js", () => ({ readProtectedRuntimeFile: mocks.readProtected }));
vi.mock("node:fs/promises", () => ({
  writeFile: mocks.writeFile, rename: mocks.rename, unlink: mocks.unlink, mkdir: mocks.mkdir,
  open: vi.fn(), readFile: vi.fn(), lstat: vi.fn(),
}));

// Deliberately real middleware/session service and the uninjected issuer router.
import { issueSessionToken } from "../../services/internalAuthService.js";
import { createGpt02ReaderCustodyWorkerIssuerRouter } from "../gpt02-reader-custody-worker-issuer.js";
import { gpt02CustodyCredentialBinding, verifyGpt02CustodyWorkerAttestation } from "../../services/gpt02ReaderCustodyAttestation.js";

const HOST = "dev.cstlogistic.co.id";
const ORIGIN = "https://" + HOST;
const ID = "11111111-2222-4333-8444-555555555555";
const URL = "/api/ai/agent-runtime/credentials/" + ID + "/custody-attestation";
const SESSION_SECRET = "synthetic-internal-session-secret-test-only";
const PRIVATE_MARKER = "SYNTHETIC_PRIVATE_DATABASE_OR_KEY_DIAGNOSTIC";
const TOKEN_HASH = createHash("sha256").update("synthetic-worker-token").digest("hex");
const BINDING = gpt02CustodyCredentialBinding(TOKEN_HASH);
const BODY = { expectedCredentialBinding: BINDING };
const OWNER = { id: 7, role: "owner", status: "active", accountType: "internal", mustChangePassword: false, email: "owner@example.invalid" };
const CREDENTIAL = { id: ID, name: "openclaw-vps-dev-consumer", tokenHash: TOKEN_HASH, scopes: ["agent:presence", "agent:work"], isActive: true, expiresAt: null };

function fixture() {
  const pair = generateKeyPairSync("ed25519");
  const privateDer = pair.privateKey.export({ type: "pkcs8", format: "der" });
  const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
  const publicB64 = publicDer.toString("base64");
  const fingerprint = createHash("sha256").update(publicDer).digest("hex");
  vi.stubEnv("GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64", publicB64);
  vi.stubEnv("GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256", fingerprint);
  mocks.readProtected.mockImplementation(async () => Buffer.from(privateDer));
  mocks.logAudit.mockResolvedValue(undefined);

  const state = {
    authOwner: { ...OWNER } as typeof OWNER | null,
    lockedOwner: { ...OWNER } as typeof OWNER | null,
    credential: { ...CREDENTIAL } as typeof CREDENTIAL | null,
    staged: [] as Array<Record<string, unknown>>, committed: [] as Array<Record<string, unknown>>,
    failCommit: false,
  };
  const authLimit = vi.fn(async () => state.authOwner ? [{ ...state.authOwner }] : []);
  mocks.authSelect.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: authLimit }) }) }));
  const shareLocks = vi.fn();
  const auditExecute = vi.fn().mockResolvedValue({ rowCount: 1 });
  const tx = {
    select: vi.fn(() => {
      let selected: unknown;
      const builder = {
        from: vi.fn((table: unknown) => { selected = table; return builder; }),
        where: vi.fn(() => builder), limit: vi.fn(() => builder),
        for: vi.fn(async (mode: string) => {
          shareLocks(selected, mode);
          if (selected === mocks.userTable) return state.lockedOwner ? [{ ...state.lockedOwner }] : [];
          if (selected === mocks.tokenTable) return state.credential ? [{ ...state.credential }] : [];
          throw new Error("Unexpected table");
        }),
      };
      return builder;
    }),
    insert: vi.fn((table: unknown) => {
      if (table !== mocks.auditTable) throw new Error("Unexpected non-audit insert");
      return { values: (value: Record<string, unknown>) => {
        state.staged.push(value);
        return { execute: auditExecute };
      } };
    }),
    update: vi.fn(), delete: vi.fn(), execute: vi.fn(),
  };
  mocks.transaction.mockImplementation(async (operation: (transaction: typeof tx) => Promise<unknown>) => {
    state.staged = [];
    const result = await operation(tx);
    if (state.failCommit) throw new Error(PRIVATE_MARKER);
    state.committed.push(...state.staged);
    return result;
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", createGpt02ReaderCustodyWorkerIssuerRouter());
  const post = (token: string | null = issueSessionToken(OWNER.id), url = URL) => {
    const pending = request(app).post(url).set("Host", HOST).set("Origin", ORIGIN);
    return token === null ? pending : pending.set("Cookie", "internal_session=" + token);
  };
  return { app, post, state, tx, authLimit, shareLocks, auditExecute, privateDer, publicB64, fingerprint };
}

describe("GPT02 worker issuer HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APP_ENV", "development"); vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED", "true");
    vi.stubEnv("GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64", undefined);
    vi.stubEnv("GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const write of [mocks.writeFile, mocks.rename, mocks.unlink, mocks.mkdir]) expect(write).not.toHaveBeenCalled();
  });

  it("keeps the default issuer router mounted in the canonical agent-runtime entry point", () => {
    const source = readFileSync(new globalThis.URL("../agent-runtime.ts", import.meta.url), "utf8");
    expect(source).toContain('from "./gpt02-reader-custody-worker-issuer.js"');
    expect(source).toMatch(/router\.use\(\s*createGpt02ReaderCustodyWorkerIssuerRouter\(\)\s*\)/);
  });

  it("uses a real Owner session, shared DB locks, fixed key read and strict committed audit to issue valid public V2", async () => {
    const f = fixture();
    const response = await f.post().send(BODY);
    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(response.body).sort()).toEqual(["receipt", "signature"]);
    const verified = verifyGpt02CustodyWorkerAttestation({
      document: response.body, authenticatedCredentialId: ID, authenticatedCredentialBinding: BINDING, now: Date.now(),
      trustedIssuerPublicDerB64: f.publicB64, trustedIssuerSha256: f.fingerprint,
    });
    expect(verified).not.toBeNull();
    expect(f.shareLocks.mock.calls).toEqual([[mocks.userTable, "share"], [mocks.tokenTable, "share"]]);
    expect(mocks.readProtected).toHaveBeenCalledExactlyOnceWith(
      "/run/credentials/gpt02-reader-custody-worker-attestor/private-key.pkcs8",
      { maxBytes: 4096, forbiddenPermissionBits: 0o177, requireRootGroup: true },
    );
    expect(f.state.committed).toHaveLength(1);
    expect(f.state.committed[0]).toMatchObject({
      module: "gpt02_reader_custody", action: "issue_worker_custody_attestation",
      resourceId: ID, actorId: "7", actorType: "internal_user", status: "success",
      details: { credentialBinding: BINDING, workerAttestationSha256: verified!.digest,
        attestorPublicKeySha256: f.fingerprint, delivery: "response_only", activeProofPublished: false },
    });
    expect(f.auditExecute).toHaveBeenCalledOnce();
    expect(f.tx.update).not.toHaveBeenCalled(); expect(f.tx.delete).not.toHaveBeenCalled(); expect(f.tx.execute).not.toHaveBeenCalled();
    expect(JSON.stringify([response.body, f.state.committed])).not.toContain(TOKEN_HASH);
    expect(response.text).not.toContain(f.privateDer.toString("base64"));
  });

  it.each([
    ["GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED", "false", 404],
    ["APP_ENV", "production", 503], ["NODE_ENV", "production", 503],
  ] as const)("blocks %s=%s before session DB lookup", async (name, value, status) => {
    const f = fixture(); vi.stubEnv(name, value);
    const response = await f.post().send(BODY);
    expect(response.status).toBe(status);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.authSelect).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.readProtected).not.toHaveBeenCalled();
  });

  it("rejects the actual pool guard before authenticating", async () => {
    const f = fixture(); mocks.isolation.mockImplementation(() => { throw new Error(PRIVATE_MARKER); });
    const response = await f.post().send(BODY);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "WORKER_CUSTODY_DEV_DATABASE_UNVERIFIED" });
    expect(mocks.authSelect).not.toHaveBeenCalled(); expect(mocks.readProtected).not.toHaveBeenCalled();
  });

  it.each([["Host", "other.example.invalid"], ["Origin", "https://other.example.invalid"], ["Origin", "http://" + HOST]])(
    "rejects mismatched %s before authentication, despite forwarded host", async (header, value) => {
      const f = fixture();
      const response = await f.post().set(header, value).set("X-Forwarded-Host", HOST).send(BODY);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "WORKER_CUSTODY_SAME_ORIGIN_REQUIRED" });
      expect(mocks.authSelect).not.toHaveBeenCalled(); expect(mocks.readProtected).not.toHaveBeenCalled();
    },
  );

  it("requires JSON before any authentication or issuance", async () => {
    const f = fixture();
    const response = await f.post().type("text").send("synthetic input");
    expect(response.status).toBe(415);
    expect(mocks.authSelect).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not accept a scoped worker bearer as an internal Owner session", async () => {
    const f = fixture();
    const response = await f.post(null).set("Authorization", "Bearer synthetic-worker-token").set("x-ai-agent-token", "synthetic-worker-token").send(BODY);
    expect(response.status).toBe(401);
    expect(mocks.authSelect).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["magic_login", "password_reset"])("rejects a validly signed %s token used as a session", async (purpose) => {
    const f = fixture();
    const token = jwt.sign({ sub: OWNER.id, purpose }, SESSION_SECRET, { expiresIn: "5m" });
    const response = await f.post(token).send(BODY);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "WORKER_CUSTODY_SESSION_REQUIRED" });
    expect(mocks.authSelect).not.toHaveBeenCalled(); expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.readProtected).not.toHaveBeenCalled();
  });

  it.each(["wrong signature", "expired", "extra authority claim"])("rejects session with %s", async (kind) => {
    const f = fixture();
    const token = kind === "wrong signature" ? jwt.sign({ sub: OWNER.id }, "different-synthetic-secret", { expiresIn: "5m" })
      : kind === "extra authority claim" ? jwt.sign({ sub: OWNER.id, role: "owner" }, SESSION_SECRET, { expiresIn: "5m" })
      : jwt.sign({ sub: OWNER.id, iat: Math.floor(Date.now() / 1000) - 100, exp: Math.floor(Date.now() / 1000) - 1 }, SESSION_SECRET);
    const response = await f.post(token).send(BODY);
    expect(response.status).toBe(401);
    expect(mocks.authSelect).not.toHaveBeenCalled(); expect(mocks.readProtected).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", { role: "admin" }], ["inactive", { status: "inactive" }],
    ["external", { accountType: "external" }], ["password pending", { mustChangePassword: true }],
  ] as const)("denies current internal account %s with a valid session", async (_name, patch) => {
    const f = fixture(); f.state.authOwner = { ...OWNER, ...patch };
    const response = await f.post().send(BODY);
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.readProtected).not.toHaveBeenCalled();
  });

  it("rereads Owner authority inside the issuance transaction after middleware allowed the request", async () => {
    const f = fixture(); f.state.lockedOwner = { ...OWNER, role: "admin" };
    const response = await f.post().send(BODY);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "WORKER_CUSTODY_OWNER_REQUIRED" });
    expect(mocks.readProtected).not.toHaveBeenCalled(); expect(f.tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    {}, { expectedCredentialBinding: "bad" }, { ...BODY, ownerId: 8 },
    { ...BODY, privateKeyPath: "/untrusted/key" }, { ...BODY, expiresAt: Number.MAX_SAFE_INTEGER },
  ])("rejects caller-selected authority/key/validity fields or invalid binding: %j", async (body) => {
    const f = fixture(); const response = await f.post().send(body);
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.readProtected).not.toHaveBeenCalled();
  });

  it("returns conflict for a stale token generation without reading the key", async () => {
    const f = fixture(); f.state.credential = { ...CREDENTIAL, tokenHash: "b".repeat(64) };
    const response = await f.post().send(BODY);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "WORKER_CUSTODY_CREDENTIAL_CHANGED" });
    expect(mocks.readProtected).not.toHaveBeenCalled(); expect(f.tx.insert).not.toHaveBeenCalled();
  });

  it.each([0, 2, null, undefined])(
    "requires exactly one confirmed inserted audit row (%j)", async (rowCount) => {
      const f = fixture(); f.auditExecute.mockResolvedValue({ rowCount });
      const response = await f.post().send(BODY);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "WORKER_CUSTODY_AUDIT_UNAVAILABLE" });
      expect(f.state.committed).toEqual([]);
      expect(response.body).not.toHaveProperty("receipt");
    },
  );

  it("withholds proof when the actual strict audit INSERT fails", async () => {
    const f = fixture(); f.auditExecute.mockRejectedValue(new Error(PRIVATE_MARKER));
    const response = await f.post().send(BODY);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "WORKER_CUSTODY_AUDIT_UNAVAILABLE" });
    expect(response.text).not.toContain(PRIVATE_MARKER); expect(f.state.committed).toEqual([]);
  });

  it("withholds proof when the outer transaction commit fails", async () => {
    const f = fixture(); f.state.failCommit = true;
    const response = await f.post().send(BODY);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "WORKER_CUSTODY_ISSUER_UNAVAILABLE" });
    expect(response.text).not.toContain(PRIVATE_MARKER); expect(f.state.committed).toEqual([]);
  });

  it("bounds authentication database errors without passing their details to the client", async () => {
    const f = fixture(); f.authLimit.mockRejectedValue(new Error(PRIVATE_MARKER));
    const response = await f.post().send(BODY);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "WORKER_CUSTODY_ISSUER_UNAVAILABLE" });
    expect(response.text).not.toContain(PRIVATE_MARKER); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
