import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, type KeyObject } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiAgentServiceTokensTable, aiAuditLogsTable, internalUsersTable,
  assertDevelopmentDatabaseIsolation, db, pool,
} from "@workspace/db";
import { readProtectedRuntimeFile } from "./gpt02ProtectedRuntimeFile.js";
import {
  GPT02_WORKER_ATTESTATION_TARGET,
  gpt02CustodyCredentialBinding,
  verifyGpt02CustodyWorkerAttestation,
} from "./gpt02ReaderCustodyAttestation.js";

export const GPT02_WORKER_CUSTODY_PRIVATE_KEY_PATH =
  "/run/credentials/gpt02-reader-custody-worker-attestor/private-key.pkcs8";
export const GPT02_WORKER_CUSTODY_TTL_MS = 60 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type Gpt02WorkerCustodyIssuerErrorCode =
  | "WORKER_CUSTODY_ISSUER_DISABLED"
  | "WORKER_CUSTODY_DEV_ENVIRONMENT_REQUIRED"
  | "WORKER_CUSTODY_DEV_DATABASE_UNVERIFIED"
  | "WORKER_CUSTODY_INVALID_REQUEST"
  | "WORKER_CUSTODY_OWNER_REQUIRED"
  | "WORKER_CUSTODY_CREDENTIAL_UNAVAILABLE"
  | "WORKER_CUSTODY_CREDENTIAL_CHANGED"
  | "WORKER_CUSTODY_ATTESTOR_NOT_CONFIGURED"
  | "WORKER_CUSTODY_ISSUER_DOMAINS_NOT_SEPARATE"
  | "WORKER_CUSTODY_PRIVATE_KEY_UNAVAILABLE"
  | "WORKER_CUSTODY_ATTESTATION_EXPIRED"
  | "WORKER_CUSTODY_AUDIT_UNAVAILABLE"
  | "WORKER_CUSTODY_ISSUER_UNAVAILABLE";

/** Only these bounded codes may leave the signing boundary. */
export class Gpt02WorkerCustodyIssuerError extends Error {
  constructor(readonly code: Gpt02WorkerCustodyIssuerErrorCode) { super(code); }
}

export type Gpt02WorkerCustodyIssueInput = Readonly<{
  ownerId: number;
  credentialId: string;
  expectedCredentialBinding: string;
}>;
export type Gpt02WorkerCustodyEnvelope = Readonly<{
  receipt: Readonly<typeof GPT02_WORKER_ATTESTATION_TARGET & {
    credentialId: string;
    credentialBinding: string;
    issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN";
    notBefore: number;
    expiresAt: number;
  }>;
  signature: string;
}>;
export type Gpt02WorkerCustodyOwnerRow = Readonly<{
  id: number; role: string; status: string; accountType: string; mustChangePassword: boolean;
}>;
export type Gpt02WorkerCustodyCredentialRow = Readonly<{
  id: string; name: string; tokenHash: string; scopes: string[];
  isActive: boolean; expiresAt: Date | null;
}>;
export type Gpt02WorkerCustodyIssuanceAudit = Readonly<{
  ownerId: number;
  credentialId: string;
  credentialBinding: string;
  workerAttestationSha256: string;
  attestorPublicKeySha256: string;
  notBefore: number;
  expiresAt: number;
}>;

export interface Gpt02WorkerCustodyIssuerTransaction {
  readOwnerForShare: (id: number) => Promise<Gpt02WorkerCustodyOwnerRow | null>;
  readCredentialForShare: (id: string) => Promise<Gpt02WorkerCustodyCredentialRow | null>;
  insertAudit: (audit: Gpt02WorkerCustodyIssuanceAudit) => Promise<void>;
}
export interface Gpt02WorkerCustodyIssuerDeps {
  environment: () => NodeJS.ProcessEnv;
  verifyDatabaseIsolation: () => void;
  readPrivateKey: () => Promise<Buffer>;
  now: () => number;
  transaction: (
    operation: (transaction: Gpt02WorkerCustodyIssuerTransaction) => Promise<Gpt02WorkerCustodyEnvelope>,
  ) => Promise<Gpt02WorkerCustodyEnvelope>;
}

function verifyRuntimeDatabaseIsolation(): void {
  assertDevelopmentDatabaseIsolation(pool.options.connectionString ?? "", {
    APP_ENV: "development",
    SUPABASE_URL_DEV: `https://${GPT02_WORKER_ATTESTATION_TARGET.project}.supabase.co`,
  });
}

/** Shared locks keep Owner authorization and the credential generation stable
 * through the strict audit commit. Revocation/rotation after commit is still
 * enforced by the broker's current-token authentication on every request. */
async function issuanceTransaction(
  operation: (transaction: Gpt02WorkerCustodyIssuerTransaction) => Promise<Gpt02WorkerCustodyEnvelope>,
): Promise<Gpt02WorkerCustodyEnvelope> {
  return db.transaction(async (tx) => operation({
    async readOwnerForShare(id) {
      const [row] = await tx.select({
        id: internalUsersTable.id, role: internalUsersTable.role,
        status: internalUsersTable.status, accountType: internalUsersTable.accountType,
        mustChangePassword: internalUsersTable.mustChangePassword,
      }).from(internalUsersTable).where(eq(internalUsersTable.id, id)).limit(1).for("share");
      return row ?? null;
    },
    async readCredentialForShare(id) {
      const [row] = await tx.select({
        id: aiAgentServiceTokensTable.id, name: aiAgentServiceTokensTable.name,
        tokenHash: aiAgentServiceTokensTable.tokenHash, scopes: aiAgentServiceTokensTable.scopes,
        isActive: aiAgentServiceTokensTable.isActive, expiresAt: aiAgentServiceTokensTable.expiresAt,
      }).from(aiAgentServiceTokensTable).where(eq(aiAgentServiceTokensTable.id, id)).limit(1).for("share");
      return row ?? null;
    },
    async insertAudit(audit) {
      try {
        const writeResult = await tx.insert(aiAuditLogsTable).values({
          module: "gpt02_reader_custody",
          action: "issue_worker_custody_attestation",
          resourceId: audit.credentialId,
          resourceType: "ai_agent_service_token",
          actorId: String(audit.ownerId),
          actorType: "internal_user",
          status: "success",
          details: {
            ...GPT02_WORKER_ATTESTATION_TARGET,
            credentialBinding: audit.credentialBinding,
            workerAttestationSha256: audit.workerAttestationSha256,
            attestorPublicKeySha256: audit.attestorPublicKeySha256,
            notBefore: audit.notBefore,
            expiresAt: audit.expiresAt,
            delivery: "response_only",
            activeProofPublished: false,
          },
        }).execute();
        // The canonical DEV audit table is INSERT-only under RLS for this
        // runtime role. RETURNING id requires row SELECT policy and fails 42501.
        // Validate the PostgreSQL committed-row count instead, without
        // broadening read privileges or suppressing the audit transaction.
        if (writeResult.rowCount !== 1) {
          throw new Error("AUDIT_INSERT_NOT_CONFIRMED");
        }
      } catch { throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_AUDIT_UNAVAILABLE"); }
    },
  }));
}

type PublicTrust = Readonly<{ publicDerB64: string; fingerprint: string; der: Buffer }>;
function publicTrust(publicDerB64: unknown, fingerprint: unknown): PublicTrust {
  try {
    if (typeof publicDerB64 !== "string" || publicDerB64.length === 0 || publicDerB64.length > 1024 ||
        publicDerB64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicDerB64) ||
        typeof fingerprint !== "string" || !SHA256.test(fingerprint)) throw new Error("UNCONFIGURED");
    const der = Buffer.from(publicDerB64, "base64");
    if (der.toString("base64") !== publicDerB64 ||
        !timingSafeEqual(createHash("sha256").update(der).digest(), Buffer.from(fingerprint, "hex"))) {
      throw new Error("UNTRUSTED");
    }
    const key = createPublicKey({ key: der, type: "spki", format: "der" });
    const canonical = key.export({ type: "spki", format: "der" });
    if (key.asymmetricKeyType !== "ed25519" || canonical.length !== der.length ||
        !timingSafeEqual(canonical, der)) throw new Error("INVALID_KEY");
    return { publicDerB64, fingerprint, der };
  } catch { throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ATTESTOR_NOT_CONFIGURED"); }
}

function configuredTrust(env: NodeJS.ProcessEnv): PublicTrust {
  const trust = publicTrust(
    env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64,
    env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256,
  );
  const otherKey = env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64;
  const otherFingerprint = env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256;
  // Worker bootstrap may precede DBA enrollment. A partially configured DBA
  // trust is rejected, and the two signing purposes must never share a key.
  if (otherKey !== undefined || otherFingerprint !== undefined) {
    const other = publicTrust(otherKey, otherFingerprint);
    if (timingSafeEqual(Buffer.from(trust.fingerprint, "hex"), Buffer.from(other.fingerprint, "hex"))) {
      throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ISSUER_DOMAINS_NOT_SEPARATE");
    }
  }
  return trust;
}

async function loadPrivateKey(read: () => Promise<Buffer>, trust: PublicTrust): Promise<KeyObject> {
  let bytes: Buffer | undefined;
  let canonical: Buffer | undefined;
  try {
    bytes = await read();
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 4096) throw new Error("INVALID_KEY");
    const key = createPrivateKey({ key: bytes, type: "pkcs8", format: "der" });
    canonical = key.export({ type: "pkcs8", format: "der" });
    const publicDer = createPublicKey(key).export({ type: "spki", format: "der" });
    if (key.asymmetricKeyType !== "ed25519" || canonical.length !== bytes.length ||
        !timingSafeEqual(canonical, bytes) || publicDer.length !== trust.der.length ||
        !timingSafeEqual(publicDer, trust.der)) throw new Error("UNTRUSTED_KEY");
    return key;
  } catch { throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_PRIVATE_KEY_UNAVAILABLE"); }
  finally { bytes?.fill(0); canonical?.fill(0); }
}

function validNow(now: number): boolean { return Number.isSafeInteger(now) && now >= 0; }

/** The production callsite uses the real database and the fixed protected key
 * input. Test injection never enters the HTTP request or deployment config.
 * This service returns public evidence only; it cannot publish a proof, issue
 * a service token, change a SQL role, or activate the reader. */
export function createGpt02ReaderCustodyWorkerIssuer(overrides: Partial<Gpt02WorkerCustodyIssuerDeps> = {}) {
  const deps: Gpt02WorkerCustodyIssuerDeps = {
    environment: () => process.env,
    verifyDatabaseIsolation: verifyRuntimeDatabaseIsolation,
    readPrivateKey: () => readProtectedRuntimeFile(GPT02_WORKER_CUSTODY_PRIVATE_KEY_PATH, {
      maxBytes: 4096, forbiddenPermissionBits: 0o177, requireRootGroup: true,
    }),
    now: Date.now,
    transaction: issuanceTransaction,
    ...overrides,
  };
  function context(): NodeJS.ProcessEnv {
    const env = deps.environment();
    if (env.GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED !== "true") {
      throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ISSUER_DISABLED");
    }
    if (env.APP_ENV !== "development" || env.NODE_ENV !== "development") {
      throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_DEV_ENVIRONMENT_REQUIRED");
    }
    try { deps.verifyDatabaseIsolation(); }
    catch { throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_DEV_DATABASE_UNVERIFIED"); }
    return env;
  }

  return {
    verifyRuntimeIsolation(): void { context(); },
    async issue(input: Gpt02WorkerCustodyIssueInput): Promise<Gpt02WorkerCustodyEnvelope> {
      try {
        const trust = configuredTrust(context());
        if (!input || !Number.isSafeInteger(input.ownerId) || input.ownerId < 1 ||
            typeof input.credentialId !== "string" || !UUID.test(input.credentialId) ||
            typeof input.expectedCredentialBinding !== "string" || !SHA256.test(input.expectedCredentialBinding)) {
          throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_INVALID_REQUEST");
        }
        const envelope = await deps.transaction(async (tx) => {
          const owner = await tx.readOwnerForShare(input.ownerId);
          if (!owner || owner.id !== input.ownerId || owner.role !== "owner" || owner.status !== "active" ||
              owner.accountType !== "internal" || owner.mustChangePassword !== false) {
            throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_OWNER_REQUIRED");
          }
          const credential = await tx.readCredentialForShare(input.credentialId);
          const tokenExpiry = credential?.expiresAt === null ? Number.MAX_SAFE_INTEGER
            : credential?.expiresAt instanceof Date ? credential.expiresAt.getTime() : NaN;
          const beforeKey = deps.now();
          if (!credential || credential.id !== input.credentialId || credential.name !== GPT02_WORKER_ATTESTATION_TARGET.service ||
              credential.isActive !== true || !Array.isArray(credential.scopes) ||
              !(credential.scopes.includes("agent:presence") || credential.scopes.includes("*")) ||
              typeof credential.tokenHash !== "string" || !SHA256.test(credential.tokenHash) ||
              !validNow(beforeKey) || !Number.isSafeInteger(tokenExpiry) || tokenExpiry <= beforeKey) {
            throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_CREDENTIAL_UNAVAILABLE");
          }
          const binding = gpt02CustodyCredentialBinding(credential.tokenHash);
          if (!timingSafeEqual(Buffer.from(binding, "hex"), Buffer.from(input.expectedCredentialBinding, "hex"))) {
            throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_CREDENTIAL_CHANGED");
          }
          const key = await loadPrivateKey(deps.readPrivateKey, trust);
          const notBefore = deps.now();
          const expiresAt = Math.min(notBefore + GPT02_WORKER_CUSTODY_TTL_MS, tokenExpiry);
          if (!validNow(notBefore) || !Number.isSafeInteger(expiresAt) || expiresAt <= notBefore) {
            throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ATTESTATION_EXPIRED");
          }
          const receipt: Gpt02WorkerCustodyEnvelope["receipt"] = Object.freeze({
            ...GPT02_WORKER_ATTESTATION_TARGET,
            credentialId: credential.id,
            credentialBinding: binding,
            issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
            notBefore,
            expiresAt,
          });
          const result = Object.freeze({
            receipt,
            signature: sign(null, Buffer.from(JSON.stringify(receipt), "utf8"), key).toString("base64url"),
          });
          const verified = verifyGpt02CustodyWorkerAttestation({
            document: result,
            trustedIssuerPublicDerB64: trust.publicDerB64, trustedIssuerSha256: trust.fingerprint,
            authenticatedCredentialId: credential.id, authenticatedCredentialBinding: binding, now: deps.now(),
          });
          if (!verified) throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ATTESTATION_EXPIRED");
          await tx.insertAudit({
            ownerId: owner.id, credentialId: credential.id, credentialBinding: binding,
            workerAttestationSha256: verified.digest, attestorPublicKeySha256: trust.fingerprint,
            notBefore, expiresAt,
          });
          const afterAudit = deps.now();
          if (!validNow(afterAudit) || afterAudit < notBefore || afterAudit >= expiresAt) {
            throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ATTESTATION_EXPIRED");
          }
          return result;
        });
        // Commit and filesystem/DB waits may cross the validity boundary. A
        // committed audit alone must never turn an expired proof into success.
        const finalTrust = configuredTrust(context());
        if (!verifyGpt02CustodyWorkerAttestation({
          document: envelope,
          trustedIssuerPublicDerB64: finalTrust.publicDerB64, trustedIssuerSha256: finalTrust.fingerprint,
          authenticatedCredentialId: input.credentialId,
          authenticatedCredentialBinding: input.expectedCredentialBinding,
          now: deps.now(),
        })) throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ATTESTATION_EXPIRED");
        return envelope;
      } catch (error) {
        if (error instanceof Gpt02WorkerCustodyIssuerError) throw error;
        throw new Gpt02WorkerCustodyIssuerError("WORKER_CUSTODY_ISSUER_UNAVAILABLE");
      }
    },
  };
}
