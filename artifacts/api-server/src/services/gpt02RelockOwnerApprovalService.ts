import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const GPT02_RELOCK_SCOPE = "GPT02_RELOCK_CST_DEV" as const;
export const GPT02_RELOCK_PROJECT_ID = "xssrfshdrtdfupgqwfdw" as const;
export const GPT02_RELOCK_WORKER_ID = "openclaw-vps-main" as const;
export const GPT02_RELOCK_HOST_ID = "srv1792369" as const;
export const GPT02_RELOCK_TTL_MS = 120_000;

const OWNER_APPROVAL_KEY_PATH = "/etc/gpt02-dev/public/gpt02-relock-owner-approval.pem";
const TRUST_MANIFEST_PATH = "/etc/gpt02-dev/trust-fingerprints.json";
const KEY_FINGERPRINT_FIELD = "gpt02RelockOwnerApproval";
const KEY_OWNER_SUBJECT_FIELD = "gpt02RelockOwnerSubject";
const KEY_OWNER_SUPABASE_ID_FIELD = "gpt02RelockOwnerAuthSupabaseId";
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

export type Gpt02OwnerActor = Readonly<{
  id: string;
  role: string;
  companyId?: string | null;
  email: string;
  authSource: string;
  authSupabaseId: string;
  authVerifiedAt: number;
}>;

export type Gpt02RelockManifest = Readonly<{
  version: 1;
  environment: "DEV";
  scope: typeof GPT02_RELOCK_SCOPE;
  projectId: typeof GPT02_RELOCK_PROJECT_ID;
  database: "postgres";
  hostId: typeof GPT02_RELOCK_HOST_ID;
  workerPrincipal: typeof GPT02_RELOCK_WORKER_ID;
  roles: readonly [
    Readonly<{ name: "dev_gpt02_relock_catalog_auditor"; canLogin: false; connectionLimit: 0; passwordState: "PRESERVE_PRESENT" }>,
    Readonly<{ name: "dev_gpt02_attestor_evidence"; canLogin: false; connectionLimit: 0; passwordState: "NULL" }>,
    Readonly<{ name: "dev_gpt02_issuer_evidence"; canLogin: false; connectionLimit: 0; passwordState: "NULL" }>,
    Readonly<{ name: "gpt02_issuer_evidence_reader"; canLogin: false; connectionLimit: 0; passwordState: "NULL" }>
  ];
  timer: Readonly<{ unit: "gpt02-issue159-relock-catalog-auditor.timer"; finalActiveState: "inactive"; finalUnitFileState: "disabled" }>;
  service: Readonly<{ unit: "gpt02-issue159-relock-catalog-auditor.service"; finalActiveState: "inactive"; finalMainPid: 0 }>;
  credential: Readonly<{ source: "/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn"; regularFile: true; symlink: false; mode: "0600"; owner: "root"; group: "root"; contentRead: false; decrypted: false }>;
  operations: readonly ["DISABLE_ISSUE159_TIMER", "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL", "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD"];
  preconditions: Readonly<{ rolesFound: 4; activeSessions: 0; openWatchdogRows: 0; serviceIdle: true; noConcurrentSupervisorRun: true }>;
  postconditions: Readonly<{ allRoleInvariantsPass: true; activeSessions: 0; openWatchdogRows: 0; timerInactiveDisabled: true; serviceIdle: true; credentialMetadataPass: true }>;
  ownerSubject: string;
  ownerAuthSupabaseId: string;
  ownerEmail: string;
  requestId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type Gpt02OwnerVerifier = (actor: Gpt02OwnerActor) => Promise<boolean>;

function deny(code: string): never {
  throw new Error(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertActorShape(actor: Gpt02OwnerActor, nowMs: number): void {
  if (
    !isPlainObject(actor) ||
    actor.role !== "super_admin" ||
    !(actor.companyId === undefined || actor.companyId === null || actor.companyId === "default") ||
    actor.authSource !== "supabase_google_identity" ||
    typeof actor.id !== "string" || !/^google_[A-Za-z0-9_-]{6,120}$/.test(actor.id) ||
    typeof actor.email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(actor.email) ||
    typeof actor.authSupabaseId !== "string" || !UUID_PATTERN.test(actor.authSupabaseId) ||
    !Number.isSafeInteger(actor.authVerifiedAt) ||
    actor.authVerifiedAt > nowMs + 30_000 ||
    actor.authVerifiedAt < nowMs - 5 * 60_000
  ) {
    deny("GPT02_OWNER_GOOGLE_SUPERADMIN_SESSION_REQUIRED");
  }
}

function assertExactManifestScope(manifest: Gpt02RelockManifest, actor: Gpt02OwnerActor, nowMs: number): void {
  const expectedRoles = [
    { name: "dev_gpt02_relock_catalog_auditor", canLogin: false, connectionLimit: 0, passwordState: "PRESERVE_PRESENT" },
    { name: "dev_gpt02_attestor_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
    { name: "dev_gpt02_issuer_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
    { name: "gpt02_issuer_evidence_reader", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
  ];
  const expectedOperations = [
    "DISABLE_ISSUE159_TIMER",
    "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL",
    "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD",
  ];
  if (
    manifest.version !== 1 || manifest.environment !== "DEV" ||
    manifest.scope !== GPT02_RELOCK_SCOPE || manifest.projectId !== GPT02_RELOCK_PROJECT_ID ||
    manifest.database !== "postgres" || manifest.hostId !== GPT02_RELOCK_HOST_ID ||
    manifest.workerPrincipal !== GPT02_RELOCK_WORKER_ID ||
    canonicalJson(manifest.roles) !== canonicalJson(expectedRoles) ||
    canonicalJson(manifest.operations) !== canonicalJson(expectedOperations) ||
    canonicalJson(manifest.timer) !== canonicalJson({ unit: "gpt02-issue159-relock-catalog-auditor.timer", finalActiveState: "inactive", finalUnitFileState: "disabled" }) ||
    canonicalJson(manifest.service) !== canonicalJson({ unit: "gpt02-issue159-relock-catalog-auditor.service", finalActiveState: "inactive", finalMainPid: 0 }) ||
    canonicalJson(manifest.credential) !== canonicalJson({ source: "/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn", regularFile: true, symlink: false, mode: "0600", owner: "root", group: "root", contentRead: false, decrypted: false }) ||
    canonicalJson(manifest.preconditions) !== canonicalJson({ rolesFound: 4, activeSessions: 0, openWatchdogRows: 0, serviceIdle: true, noConcurrentSupervisorRun: true }) ||
    canonicalJson(manifest.postconditions) !== canonicalJson({ allRoleInvariantsPass: true, activeSessions: 0, openWatchdogRows: 0, timerInactiveDisabled: true, serviceIdle: true, credentialMetadataPass: true }) ||
    manifest.ownerSubject !== `owner:${actor.id}` ||
    manifest.ownerAuthSupabaseId !== actor.authSupabaseId.toLowerCase() ||
    manifest.ownerEmail !== actor.email.toLowerCase() ||
    !UUID_PATTERN.test(manifest.requestId) ||
    typeof manifest.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(manifest.nonce) ||
    !Number.isSafeInteger(manifest.issuedAt) || !Number.isSafeInteger(manifest.expiresAt) ||
    manifest.issuedAt > nowMs + 30_000 || manifest.issuedAt < nowMs - GPT02_RELOCK_TTL_MS - 30_000 ||
    manifest.expiresAt <= nowMs || manifest.expiresAt - manifest.issuedAt !== GPT02_RELOCK_TTL_MS
  ) {
    deny("GPT02_OWNER_APPROVAL_MANIFEST_SCOPE_INVALID");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) deny("GPT02_MANIFEST_NUMBER_INVALID");
    return JSON.stringify(value) ?? "null";
  }
  deny("GPT02_MANIFEST_VALUE_INVALID");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeGpt02RelockManifest(manifest: Gpt02RelockManifest): Buffer {
  return Buffer.from(`CST_GPT02_RELOCK_OWNER_APPROVAL_V1\n${canonicalJson(manifest)}`, "utf8");
}

export function digestGpt02RelockManifest(manifest: Gpt02RelockManifest): string {
  return sha256(canonicalizeGpt02RelockManifest(manifest));
}

export function verifyGpt02RelockOwnerSignatureWithKey(input: {
  manifest: Gpt02RelockManifest;
  signature: string;
  publicKey: KeyObject;
}): boolean {
  if (input.publicKey.asymmetricKeyType !== "ed25519" || !BASE64URL_SIGNATURE_PATTERN.test(input.signature)) return false;
  try {
    const signature = Buffer.from(input.signature, "base64url");
    return signature.length === 64 && signature.toString("base64url") === input.signature &&
      verifySignature(null, canonicalizeGpt02RelockManifest(input.manifest), input.publicKey, signature);
  } catch {
    return false;
  }
}

export async function createGpt02RelockOwnerChallenge(input: {
  actor: Gpt02OwnerActor;
  verifyOwner: Gpt02OwnerVerifier;
  nowMs?: number;
}): Promise<{
  challengeId: string;
  manifest: Gpt02RelockManifest;
  canonicalPayload: string;
  manifestSha256: string;
  signatureAlgorithm: "Ed25519";
  expiresAt: string;
}> {
  const nowMs = input.nowMs ?? Date.now();
  assertActorShape(input.actor, nowMs);
  if (typeof input.verifyOwner !== "function" || await input.verifyOwner(input.actor) !== true) {
    deny("GPT02_OWNER_IDENTITY_NOT_ELIGIBLE");
  }
  // Refuse to create an approval challenge unless the dedicated Owner key is
  // already pinned. This avoids presenting an approval UI that cannot verify.
  await loadPinnedOwnerApprovalKey(input.actor);

  const nonce = randomBytes(32).toString("base64url");
  const requestId = randomUUID();
  const manifest: Gpt02RelockManifest = Object.freeze({
    version: 1,
    environment: "DEV",
    scope: GPT02_RELOCK_SCOPE,
    projectId: GPT02_RELOCK_PROJECT_ID,
    database: "postgres",
    hostId: GPT02_RELOCK_HOST_ID,
    workerPrincipal: GPT02_RELOCK_WORKER_ID,
    roles: [
      { name: "dev_gpt02_relock_catalog_auditor", canLogin: false, connectionLimit: 0, passwordState: "PRESERVE_PRESENT" },
      { name: "dev_gpt02_attestor_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
      { name: "dev_gpt02_issuer_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
      { name: "gpt02_issuer_evidence_reader", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
    ] as const,
    timer: { unit: "gpt02-issue159-relock-catalog-auditor.timer", finalActiveState: "inactive", finalUnitFileState: "disabled" },
    service: { unit: "gpt02-issue159-relock-catalog-auditor.service", finalActiveState: "inactive", finalMainPid: 0 },
    credential: {
      source: "/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn",
      regularFile: true, symlink: false, mode: "0600", owner: "root", group: "root",
      contentRead: false, decrypted: false,
    },
    operations: [
      "DISABLE_ISSUE159_TIMER",
      "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL",
      "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD",
    ] as const,
    preconditions: { rolesFound: 4, activeSessions: 0, openWatchdogRows: 0, serviceIdle: true, noConcurrentSupervisorRun: true },
    postconditions: { allRoleInvariantsPass: true, activeSessions: 0, openWatchdogRows: 0, timerInactiveDisabled: true, serviceIdle: true, credentialMetadataPass: true },
    ownerSubject: `owner:${input.actor.id}`,
    ownerAuthSupabaseId: input.actor.authSupabaseId.toLowerCase(),
    ownerEmail: input.actor.email.toLowerCase(),
    requestId,
    nonce,
    issuedAt: nowMs,
    expiresAt: nowMs + GPT02_RELOCK_TTL_MS,
  });

  const canonicalPayload = canonicalizeGpt02RelockManifest(manifest);
  const manifestSha256 = sha256(canonicalPayload);
  const challengeId = randomUUID();
  const nonceHash = sha256(nonce);

  // The challenge store is migration-managed. The runtime never creates schema.
  await db.execute(sql`
    UPDATE ai_platform.gpt02_relock_owner_approval_challenges
    SET status = 'EXPIRED'
    WHERE scope = ${GPT02_RELOCK_SCOPE}
      AND status = 'PENDING'
      AND expires_at <= NOW()
  `);
  await db.execute(sql`
    INSERT INTO ai_platform.gpt02_relock_owner_approval_challenges (
      id, scope, owner_subject, owner_auth_supabase_id, owner_email,
      worker_principal, environment, project_id, request_id,
      manifest_json, manifest_sha256, nonce_hash, issued_at, expires_at, status
    ) VALUES (
      ${challengeId}::uuid, ${GPT02_RELOCK_SCOPE}, ${manifest.ownerSubject},
      ${manifest.ownerAuthSupabaseId}::uuid, ${manifest.ownerEmail},
      ${GPT02_RELOCK_WORKER_ID}, 'DEV', ${GPT02_RELOCK_PROJECT_ID},
      ${requestId}::uuid, ${JSON.stringify(manifest)}::jsonb,
      ${manifestSha256}, ${nonceHash}, to_timestamp(${nowMs} / 1000.0),
      to_timestamp(${manifest.expiresAt} / 1000.0), 'PENDING'
    )
  `);

  return {
    challengeId,
    manifest,
    canonicalPayload: canonicalPayload.toString("base64url"),
    manifestSha256,
    signatureAlgorithm: "Ed25519",
    expiresAt: new Date(manifest.expiresAt).toISOString(),
  };
}

async function loadPinnedOwnerApprovalKey(expectedOwner?: Gpt02OwnerActor): Promise<{ key: KeyObject; fingerprint: string }> {
  let keyInfo;
  let trustInfo;
  try {
    [keyInfo, trustInfo] = await Promise.all([lstat(OWNER_APPROVAL_KEY_PATH), lstat(TRUST_MANIFEST_PATH)]);
  } catch {
    deny("GPT02_OWNER_APPROVAL_TRUST_ANCHOR_MISSING");
  }
  if (
    !keyInfo!.isFile() || keyInfo!.isSymbolicLink() || keyInfo!.uid !== 0 || keyInfo!.gid !== 0 ||
    (keyInfo!.mode & 0o777) !== 0o440 ||
    !trustInfo!.isFile() || trustInfo!.isSymbolicLink() || trustInfo!.uid !== 0 || trustInfo!.gid !== 0 ||
    (trustInfo!.mode & 0o777) !== 0o644
  ) {
    deny("GPT02_OWNER_APPROVAL_TRUST_CUSTODY_INVALID");
  }

  const [pem, trustBytes] = await Promise.all([
    readFile(OWNER_APPROVAL_KEY_PATH),
    readFile(TRUST_MANIFEST_PATH),
  ]);
  if (pem.length === 0 || pem.length > 4096 || trustBytes.length > 16_384) {
    deny("GPT02_OWNER_APPROVAL_TRUST_FILE_SIZE_INVALID");
  }
  let trust: unknown;
  try { trust = JSON.parse(trustBytes.toString("utf8")); } catch { deny("GPT02_OWNER_APPROVAL_TRUST_MANIFEST_INVALID"); }
  if (!isPlainObject(trust) || typeof trust[KEY_FINGERPRINT_FIELD] !== "string" || !HEX_SHA256_PATTERN.test(trust[KEY_FINGERPRINT_FIELD]) ||
      typeof trust[KEY_OWNER_SUBJECT_FIELD] !== "string" || !/^owner:google_[A-Za-z0-9_-]{6,120}$/.test(trust[KEY_OWNER_SUBJECT_FIELD]) ||
      typeof trust[KEY_OWNER_SUPABASE_ID_FIELD] !== "string" || !UUID_PATTERN.test(trust[KEY_OWNER_SUPABASE_ID_FIELD])) {
    deny("GPT02_OWNER_APPROVAL_FINGERPRINT_NOT_PROVISIONED");
  }
  if (expectedOwner && (trust[KEY_OWNER_SUBJECT_FIELD] !== `owner:${expectedOwner.id}` ||
      trust[KEY_OWNER_SUPABASE_ID_FIELD] !== expectedOwner.authSupabaseId.toLowerCase())) {
    deny("GPT02_OWNER_APPROVAL_KEY_OWNER_BINDING_MISMATCH");
  }
  let key: KeyObject;
  try { key = createPublicKey(pem); } catch { deny("GPT02_OWNER_APPROVAL_PUBLIC_KEY_INVALID"); }
  if (key!.asymmetricKeyType !== "ed25519") deny("GPT02_OWNER_APPROVAL_KEY_NOT_ED25519");
  const fingerprint = sha256(key!.export({ type: "spki", format: "der" }) as Buffer);
  if (fingerprint !== trust[KEY_FINGERPRINT_FIELD]) deny("GPT02_OWNER_APPROVAL_FINGERPRINT_MISMATCH");
  return { key: key!, fingerprint };
}

export async function verifyAndRecordGpt02RelockOwnerApproval(input: {
  actor: Gpt02OwnerActor;
  verifyOwner: Gpt02OwnerVerifier;
  challengeId: string;
  signature: string;
  nowMs?: number;
}): Promise<{
  recorded: true;
  ownerApprovalVerified: true;
  executionPermitted: false;
  signingPermitted: false;
  dispatchPermitted: false;
  releaseDecision: "NO_GO";
  manifestSha256: string;
}> {
  const nowMs = input.nowMs ?? Date.now();
  assertActorShape(input.actor, nowMs);
  if (typeof input.verifyOwner !== "function" || await input.verifyOwner(input.actor) !== true) {
    deny("GPT02_OWNER_IDENTITY_NOT_ELIGIBLE");
  }
  if (!UUID_PATTERN.test(input.challengeId) || !BASE64URL_SIGNATURE_PATTERN.test(input.signature)) {
    deny("GPT02_OWNER_APPROVAL_SUBMISSION_INVALID");
  }

  const result = await db.execute(sql`
    SELECT id, owner_subject, owner_auth_supabase_id, owner_email, manifest_json,
           manifest_sha256, nonce_hash, expires_at, status
    FROM ai_platform.gpt02_relock_owner_approval_challenges
    WHERE id = ${input.challengeId}::uuid
    LIMIT 1
  `);
  const row = Array.isArray(result.rows) ? result.rows[0] as Record<string, unknown> | undefined : undefined;
  if (!row) deny("GPT02_OWNER_APPROVAL_CHALLENGE_NOT_FOUND");
  if (row.status !== "PENDING") deny("GPT02_OWNER_APPROVAL_CHALLENGE_NOT_PENDING");
  if (new Date(String(row.expires_at)).getTime() <= nowMs) deny("GPT02_OWNER_APPROVAL_CHALLENGE_EXPIRED");
  if (
    row.owner_subject !== `owner:${input.actor.id}` ||
    row.owner_auth_supabase_id !== input.actor.authSupabaseId.toLowerCase() ||
    row.owner_email !== input.actor.email.toLowerCase()
  ) deny("GPT02_OWNER_APPROVAL_ACTOR_MISMATCH");

  const manifest = row.manifest_json as Gpt02RelockManifest;
  if (!isPlainObject(manifest)) deny("GPT02_OWNER_APPROVAL_MANIFEST_SCOPE_INVALID");
  assertExactManifestScope(manifest, input.actor, nowMs);
  const canonicalPayload = canonicalizeGpt02RelockManifest(manifest);
  const digest = sha256(canonicalPayload);
  if (digest !== row.manifest_sha256 || !HEX_SHA256_PATTERN.test(digest)) {
    deny("GPT02_OWNER_APPROVAL_MANIFEST_DIGEST_MISMATCH");
  }
  const nonceHash = sha256(manifest.nonce);
  if (nonceHash !== row.nonce_hash || manifest.expiresAt <= nowMs || manifest.issuedAt > nowMs + 30_000) {
    deny("GPT02_OWNER_APPROVAL_NONCE_OR_TIME_INVALID");
  }

  const { key, fingerprint } = await loadPinnedOwnerApprovalKey(input.actor);
  if (!verifyGpt02RelockOwnerSignatureWithKey({ manifest, signature: input.signature, publicKey: key })) {
    deny("GPT02_OWNER_APPROVAL_SIGNATURE_INVALID");
  }
  const signatureSha256 = sha256(Buffer.from(input.signature, "base64url"));

  await db.transaction(async (tx) => {
    const consumed = await tx.execute(sql`
      UPDATE ai_platform.gpt02_relock_owner_approval_challenges
      SET status = 'CONSUMED', consumed_at = NOW()
      WHERE id = ${input.challengeId}::uuid
        AND status = 'PENDING'
        AND expires_at > NOW()
        AND owner_subject = ${`owner:${input.actor.id}`}
        AND manifest_sha256 = ${digest}
        AND nonce_hash = ${nonceHash}
      RETURNING id
    `);
    if (!Array.isArray(consumed.rows) || consumed.rows.length !== 1) {
      deny("GPT02_OWNER_APPROVAL_NONCE_REPLAY_OR_RACE");
    }
    await tx.execute(sql`
      INSERT INTO ai_platform.gpt02_relock_owner_approval_decisions (
        challenge_id, scope, owner_subject, worker_principal,
        manifest_sha256, signature_sha256, approval_key_fingerprint,
        decision, decided_at
      ) VALUES (
        ${input.challengeId}::uuid, ${GPT02_RELOCK_SCOPE}, ${`owner:${input.actor.id}`},
        ${GPT02_RELOCK_WORKER_ID}, ${digest}, ${signatureSha256}, ${fingerprint},
        'APPROVED', NOW()
      )
    `);
  });

  return {
    recorded: true,
    ownerApprovalVerified: true,
    executionPermitted: false,
    signingPermitted: false,
    dispatchPermitted: false,
    releaseDecision: "NO_GO",
    manifestSha256: digest,
  };
}

// Explicitly expose only public, non-secret availability metadata. No fallback
// to the Task #189 approval key or generic SECURITY_CHANGE token is permitted.
export async function getGpt02RelockOwnerApprovalReadiness(): Promise<{
  dedicatedTrustAnchorPresent: boolean;
  task189KeyFallbackPermitted: false;
  runtimeRouteIntegrated: false;
}> {
  try {
    await loadPinnedOwnerApprovalKey();
    return { dedicatedTrustAnchorPresent: true, task189KeyFallbackPermitted: false, runtimeRouteIntegrated: false };
  } catch {
    return { dedicatedTrustAnchorPresent: false, task189KeyFallbackPermitted: false, runtimeRouteIntegrated: false };
  }
}
