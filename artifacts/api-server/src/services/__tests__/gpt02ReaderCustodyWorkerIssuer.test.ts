import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), isolation: vi.fn(), readProtected: vi.fn(),
  writeFile: vi.fn(), rename: vi.fn(), unlink: vi.fn(), mkdir: vi.fn(),
  pool: { options: { connectionString: "postgresql://synthetic-only/db" } },
}));
vi.mock("@workspace/db", () => ({
  db: { transaction: mocks.transaction }, pool: mocks.pool,
  assertDevelopmentDatabaseIsolation: mocks.isolation,
  aiAgentServiceTokensTable: {}, aiAuditLogsTable: {}, internalUsersTable: {},
}));
vi.mock("../gpt02ProtectedRuntimeFile.js", () => ({ readProtectedRuntimeFile: mocks.readProtected }));
vi.mock("node:fs/promises", () => ({
  writeFile: mocks.writeFile, rename: mocks.rename, unlink: mocks.unlink, mkdir: mocks.mkdir,
  open: vi.fn(), readFile: vi.fn(), lstat: vi.fn(),
}));

import {
  createGpt02ReaderCustodyWorkerIssuer, Gpt02WorkerCustodyIssuerError,
  GPT02_WORKER_CUSTODY_PRIVATE_KEY_PATH, GPT02_WORKER_CUSTODY_TTL_MS,
  type Gpt02WorkerCustodyCredentialRow, type Gpt02WorkerCustodyOwnerRow,
  type Gpt02WorkerCustodyIssuanceAudit, type Gpt02WorkerCustodyIssuerDeps,
  type Gpt02WorkerCustodyIssuerTransaction,
} from "../gpt02ReaderCustodyWorkerIssuer.js";
import {
  GPT02_DBA_CUSTODY_TARGET, gpt02CustodyCredentialBinding,
  verifyGpt02CustodyWorkerAttestation, verifyGpt02DbaCustodyReceipt,
} from "../gpt02ReaderCustodyAttestation.js";

const NOW = 1_800_000_000_000;
const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN_HASH = createHash("sha256").update("synthetic-worker-token").digest("hex");
const BINDING = gpt02CustodyCredentialBinding(TOKEN_HASH);
const OWNER: Gpt02WorkerCustodyOwnerRow = {
  id: 7, role: "owner", status: "active", accountType: "internal", mustChangePassword: false,
};
const CREDENTIAL: Gpt02WorkerCustodyCredentialRow = {
  id: ID, name: "openclaw-vps-dev-consumer", tokenHash: TOKEN_HASH,
  scopes: ["agent:presence", "agent:work"], isActive: true, expiresAt: null,
};
const INPUT = { ownerId: OWNER.id, credentialId: ID, expectedCredentialBinding: BINDING };

function keyFixture() {
  const pair = generateKeyPairSync("ed25519");
  const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
  return {
    ...pair, privateDer: pair.privateKey.export({ type: "pkcs8", format: "der" }),
    publicB64: publicDer.toString("base64"), fingerprint: createHash("sha256").update(publicDer).digest("hex"),
  };
}

function fixture() {
  const keys = keyFixture();
  const env: NodeJS.ProcessEnv = {
    APP_ENV: "development", NODE_ENV: "development", GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED: "true",
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64: keys.publicB64,
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256: keys.fingerprint,
  };
  const state = {
    now: NOW, owner: { ...OWNER } as Gpt02WorkerCustodyOwnerRow | null,
    credential: { ...CREDENTIAL } as Gpt02WorkerCustodyCredentialRow | null,
    pending: [] as Gpt02WorkerCustodyIssuanceAudit[], committed: [] as Gpt02WorkerCustodyIssuanceAudit[],
    events: [] as string[], buffers: [] as Buffer[],
    afterAudit: undefined as (() => void) | undefined,
    afterCommit: undefined as (() => void) | undefined,
    commitFailure: false,
  };
  const tx = {
    readOwnerForShare: vi.fn(async () => state.owner && { ...state.owner }),
    readCredentialForShare: vi.fn(async () => state.credential && { ...state.credential }),
    insertAudit: vi.fn(async (audit: Gpt02WorkerCustodyIssuanceAudit) => {
      state.pending.push({ ...audit });
      state.events.push("audit");
      state.afterAudit?.();
    }),
  } satisfies Gpt02WorkerCustodyIssuerTransaction;
  const deps = {
    environment: () => env,
    verifyDatabaseIsolation: vi.fn(),
    now: () => state.now,
    readPrivateKey: vi.fn(async (): Promise<Buffer> => {
      const bytes = Buffer.from(keys.privateDer);
      state.buffers.push(bytes);
      return bytes;
    }),
    transaction: vi.fn(async (operation: Parameters<Gpt02WorkerCustodyIssuerDeps["transaction"]>[0]) => {
      state.pending = [];
      state.events.push("begin");
      try {
        const result = await operation(tx);
        if (state.commitFailure) throw new Error("SYNTHETIC_PRIVATE_COMMIT_DIAGNOSTIC");
        state.committed.push(...state.pending);
        state.events.push("commit");
        state.afterCommit?.();
        return result;
      } catch (error) {
        state.pending = [];
        state.events.push("rollback");
        throw error;
      }
    }),
  } satisfies Gpt02WorkerCustodyIssuerDeps;
  const issuer = createGpt02ReaderCustodyWorkerIssuer(deps);
  const verify = (document: unknown, binding = BINDING, now = state.now) => verifyGpt02CustodyWorkerAttestation({
    document, authenticatedCredentialId: ID, authenticatedCredentialBinding: binding, now,
    trustedIssuerPublicDerB64: keys.publicB64, trustedIssuerSha256: keys.fingerprint,
  });
  return { keys, env, state, tx, deps, issuer, verify };
}

async function denied(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(Gpt02WorkerCustodyIssuerError);
  expect(error).toMatchObject({ message: code, code });
  expect(error).not.toHaveProperty("cause");
}

describe("GPT02 Owner-authorized worker custody issuance", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    for (const write of [mocks.writeFile, mocks.rename, mocks.unlink, mocks.mkdir]) expect(write).not.toHaveBeenCalled();
  });

  it("returns a real V2 proof only after its public issuance audit commits", async () => {
    const f = fixture();
    const envelope = await f.issuer.issue(INPUT);
    const verified = f.verify(envelope);
    expect(verified).not.toBeNull();
    expect(Object.keys(envelope).sort()).toEqual(["receipt", "signature"]);
    expect(envelope.receipt).toMatchObject({
      credentialId: ID, credentialBinding: BINDING, issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
      notBefore: NOW, expiresAt: NOW + 3_600_000,
    });
    expect(GPT02_WORKER_CUSTODY_TTL_MS).toBe(3_600_000);
    expect(f.state.events).toEqual(["begin", "audit", "commit"]);
    expect(f.state.committed).toEqual([{
      ownerId: OWNER.id, credentialId: ID, credentialBinding: BINDING,
      workerAttestationSha256: verified!.digest, attestorPublicKeySha256: f.keys.fingerprint,
      notBefore: NOW, expiresAt: NOW + 3_600_000,
    }]);
    expect(JSON.stringify([envelope, f.state.committed])).not.toContain(TOKEN_HASH);
    expect(f.state.buffers[0].every((byte) => byte === 0)).toBe(true);
    expect(f.verify(envelope, BINDING, envelope.receipt.expiresAt)).toBeNull();
  });

  it("bounds validity by the existing worker credential expiry", async () => {
    const f = fixture();
    f.state.credential = { ...CREDENTIAL, expiresAt: new Date(NOW + 10_000) };
    const envelope = await f.issuer.issue(INPUT);
    expect(envelope.receipt.expiresAt).toBe(NOW + 10_000);
    expect(f.verify(envelope, BINDING, NOW + 9_999)).not.toBeNull();
    expect(f.verify(envelope, BINDING, NOW + 10_000)).toBeNull();
  });

  it.each([
    ["disabled", { GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED: "false" }, "WORKER_CUSTODY_ISSUER_DISABLED"],
    ["wrong APP_ENV", { APP_ENV: "production" }, "WORKER_CUSTODY_DEV_ENVIRONMENT_REQUIRED"],
    ["wrong NODE_ENV", { NODE_ENV: "test" }, "WORKER_CUSTODY_DEV_ENVIRONMENT_REQUIRED"],
  ] as const)("rejects %s before transaction or key access", async (_name, patch, code) => {
    const f = fixture(); Object.assign(f.env, patch);
    await denied(f.issuer.issue(INPUT), code);
    expect(f.deps.transaction).not.toHaveBeenCalled();
    expect(f.deps.readPrivateKey).not.toHaveBeenCalled();
  });

  it("rejects a wrong actual database pool before any credential/key operation", async () => {
    const f = fixture();
    f.deps.verifyDatabaseIsolation.mockImplementation(() => { throw new Error("SYNTHETIC_PRIVATE_DSN"); });
    await denied(f.issuer.issue(INPUT), "WORKER_CUSTODY_DEV_DATABASE_UNVERIFIED");
    expect(f.deps.transaction).not.toHaveBeenCalled();
    expect(f.deps.readPrivateKey).not.toHaveBeenCalled();
  });

  it.each([
    ["absent Owner", null], ["different Owner", { ...OWNER, id: 8 }],
    ["admin instead of Owner", { ...OWNER, role: "admin" }],
    ["disabled Owner", { ...OWNER, status: "inactive" }],
    ["external account", { ...OWNER, accountType: "external" }],
    ["required password change", { ...OWNER, mustChangePassword: true }],
  ])("requires current DB authority: %s", async (_name, owner) => {
    const f = fixture(); f.state.owner = owner as Gpt02WorkerCustodyOwnerRow | null;
    await denied(f.issuer.issue(INPUT), "WORKER_CUSTODY_OWNER_REQUIRED");
    expect(f.tx.readCredentialForShare).not.toHaveBeenCalled();
    expect(f.deps.readPrivateKey).not.toHaveBeenCalled();
    expect(f.state.committed).toEqual([]);
  });

  it.each([
    ["missing credential", null], ["different id", { ...CREDENTIAL, id: OTHER_ID }],
    ["different service", { ...CREDENTIAL, name: "openclaw-other-worker" }],
    ["revoked", { ...CREDENTIAL, isActive: false }],
    ["expired", { ...CREDENTIAL, expiresAt: new Date(NOW) }],
    ["invalid expiry", { ...CREDENTIAL, expiresAt: new Date(NaN) }],
    ["model-only scopes", { ...CREDENTIAL, scopes: ["model:chat"] }],
    ["work-only scopes", { ...CREDENTIAL, scopes: ["agent:work"] }],
    ["invalid stored hash", { ...CREDENTIAL, tokenHash: "synthetic-invalid-hash" }],
  ])("rejects %s before reading a private key", async (_name, credential) => {
    const f = fixture(); f.state.credential = credential as Gpt02WorkerCustodyCredentialRow | null;
    await denied(f.issuer.issue(INPUT), "WORKER_CUSTODY_CREDENTIAL_UNAVAILABLE");
    expect(f.deps.readPrivateKey).not.toHaveBeenCalled();
    expect(f.tx.insertAudit).not.toHaveBeenCalled();
  });

  it.each([["*"], ["agent:presence", "agent:work", "model:chat"]])(
    "preserves the broker's existing presence-scope semantics for %j", async (...scopes) => {
      const f = fixture(); f.state.credential = { ...CREDENTIAL, scopes };
      expect(f.verify(await f.issuer.issue(INPUT))).not.toBeNull();
    },
  );

  it.each([
    ["raw token hash", TOKEN_HASH],
    ["Task189 binding", createHash("sha256").update("CST-DEV/task189/credential/v1\0").update(TOKEN_HASH).digest("hex")],
    ["old token generation", gpt02CustodyCredentialBinding("b".repeat(64))],
  ])("rejects %s in the expected binding field", async (_name, expectedCredentialBinding) => {
    const f = fixture();
    await denied(f.issuer.issue({ ...INPUT, expectedCredentialBinding }), "WORKER_CUSTODY_CREDENTIAL_CHANGED");
    expect(f.deps.readPrivateKey).not.toHaveBeenCalled();
  });

  it("enforces rotation on later requests rather than caching a credential grant", async () => {
    const f = fixture();
    const first = await f.issuer.issue(INPUT);
    f.state.credential = { ...CREDENTIAL, tokenHash: "b".repeat(64) };
    await denied(f.issuer.issue(INPUT), "WORKER_CUSTODY_CREDENTIAL_CHANGED");
    expect(f.verify(first, gpt02CustodyCredentialBinding("b".repeat(64)))).toBeNull();
    expect(f.state.committed).toHaveLength(1);
    expect(f.deps.readPrivateKey).toHaveBeenCalledOnce();
  });

  it.each(["missing", "fingerprint mismatch", "partial DBA pin", "shared DBA key"])(
    "rejects %s trust before private-key access", async (kind) => {
      const f = fixture();
      if (kind === "missing") delete f.env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64;
      if (kind === "fingerprint mismatch") f.env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256 = "0".repeat(64);
      if (kind === "partial DBA pin") f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 = "b".repeat(64);
      if (kind === "shared DBA key") {
        f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64 = f.keys.publicB64;
        f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 = f.keys.fingerprint;
      }
      await denied(f.issuer.issue(INPUT), kind === "shared DBA key"
        ? "WORKER_CUSTODY_ISSUER_DOMAINS_NOT_SEPARATE" : "WORKER_CUSTODY_ATTESTOR_NOT_CONFIGURED");
      expect(f.deps.readPrivateKey).not.toHaveBeenCalled();
      expect(f.deps.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "different key", "trailing DER", "wrong algorithm"])(
    "rejects %s private key with a bounded error", async (kind) => {
      const f = fixture();
      let bytes: Buffer | undefined;
      if (kind === "missing") f.deps.readPrivateKey.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_KEY_DIAGNOSTIC"));
      else {
        bytes = kind === "different key" ? keyFixture().privateDer
          : kind === "trailing DER" ? Buffer.concat([f.keys.privateDer, Buffer.from([0])])
          : generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "der" });
        f.deps.readPrivateKey.mockResolvedValue(bytes);
      }
      await denied(f.issuer.issue(INPUT), "WORKER_CUSTODY_PRIVATE_KEY_UNAVAILABLE");
      expect(f.tx.insertAudit).not.toHaveBeenCalled();
      if (bytes) expect(bytes.every((byte) => byte === 0)).toBe(true);
    },
  );

  it("uses the real default protected path and root-only key policy", async () => {
    const f = fixture();
    const { readPrivateKey: _read, verifyDatabaseIsolation: _isolation, ...overrides } = f.deps;
    mocks.readProtected.mockResolvedValue(Buffer.from(f.keys.privateDer));
    const issuer = createGpt02ReaderCustodyWorkerIssuer(overrides);
    expect(f.verify(await issuer.issue(INPUT))).not.toBeNull();
    expect(GPT02_WORKER_CUSTODY_PRIVATE_KEY_PATH).toBe("/run/credentials/gpt02-reader-custody-worker-attestor/private-key.pkcs8");
    expect(mocks.readProtected).toHaveBeenCalledExactlyOnceWith(GPT02_WORKER_CUSTODY_PRIVATE_KEY_PATH, {
      maxBytes: 4096, forbiddenPermissionBits: 0o177, requireRootGroup: true,
    });
    expect(mocks.isolation).toHaveBeenCalledWith(mocks.pool.options.connectionString, {
      APP_ENV: "development", SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
    });
  });

  it.each(["audit", "commit"])("withholds the envelope on %s failure", async (stage) => {
    const f = fixture();
    if (stage === "audit") f.tx.insertAudit.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_AUDIT_DIAGNOSTIC"));
    else f.state.commitFailure = true;
    await denied(f.issuer.issue(INPUT), "WORKER_CUSTODY_ISSUER_UNAVAILABLE");
    expect(f.state.committed).toEqual([]);
    expect(f.state.events.at(-1)).toBe("rollback");
  });

  it.each(["key read", "audit", "commit"])("withholds proof expiring during %s", async (stage) => {
    const f = fixture();
    f.state.credential = { ...CREDENTIAL, expiresAt: new Date(NOW + 100) };
    const expire = () => { f.state.now = NOW + 100; };
    if (stage === "key read") f.deps.readPrivateKey.mockImplementation(async () => { expire(); return Buffer.from(f.keys.privateDer); });
    if (stage === "audit") f.state.afterAudit = expire;
    if (stage === "commit") f.state.afterCommit = expire;
    await denied(f.issuer.issue(INPUT), "WORKER_CUSTODY_ATTESTATION_EXPIRED");
    expect(f.state.committed).toHaveLength(stage === "commit" ? 1 : 0);
  });

  it("rechecks flag and trust after commit before releasing public evidence", async () => {
    for (const change of ["flag", "trust"]) {
      const f = fixture();
      f.state.afterCommit = () => {
        if (change === "flag") f.env.GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED = "false";
        else f.env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256 = "0".repeat(64);
      };
      await denied(f.issuer.issue(INPUT), change === "flag"
        ? "WORKER_CUSTODY_ISSUER_DISABLED" : "WORKER_CUSTODY_ATTESTOR_NOT_CONFIGURED");
      expect(f.state.committed).toHaveLength(1);
    }
  });

  it("fresh audited issuance leaves old proof usable, while renewal requires a matching DBA digest", async () => {
    const f = fixture(); const dba = keyFixture();
    f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64 = dba.publicB64;
    f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 = dba.fingerprint;
    const first = await f.issuer.issue(INPUT);
    const firstWorker = f.verify(first)!;
    const receipt = {
      ...GPT02_DBA_CUSTODY_TARGET, credentialId: ID, credentialBinding: BINDING,
      workerAttestationSha256: firstWorker.digest, receiptId: OTHER_ID,
      notBefore: NOW, expiresAt: NOW + 60_000,
    };
    const document = { receipt, signature: sign(null, Buffer.from(JSON.stringify(receipt)), dba.privateKey).toString("base64url") };
    f.state.now += 1_000;
    const second = await f.issuer.issue(INPUT);
    expect(f.state.committed).toHaveLength(2);
    expect(f.verify(first)).not.toBeNull();
    expect(f.verify(second)!.digest).not.toBe(firstWorker.digest);
    const verifyDba = (worker: ReturnType<typeof f.verify>) => verifyGpt02DbaCustodyReceipt({
      document, verifiedWorker: worker, now: f.state.now,
      trustedIssuerPublicDerB64: dba.publicB64, trustedIssuerSha256: dba.fingerprint,
    });
    expect(verifyDba(f.verify(first)).verified).toBe(true);
    expect(verifyDba(f.verify(second)).verified).toBe(false);
  });
});
