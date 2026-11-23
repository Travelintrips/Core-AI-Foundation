import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const GPT02_RELOCK_SCOPE = "GPT02_RELOCK_CST_DEV" as const;
export const GPT02_RELOCK_PROJECT_ID = "xssrfshdrtdfupgqwfdw" as const;
export const GPT02_RELOCK_WORKER_ID = "openclaw-vps-main" as const;
export const GPT02_RELOCK_HOST_ID = "srv1792369" as const;
export const GPT02_RELOCK_TTL_MS = 120_000;

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

function assertActorShape(actor: Gpt02OwnerActor, nowMs: number): void {
  if (
    !isPlainObject(actor) || actor.role !== "super_admin" ||
    !(actor.companyId === undefined || actor.companyId === null || actor.companyId === "default") ||
    actor.authSource !== "supabase_google_identity" ||
    typeof actor.id !== "string" || !/^google_[A-Za-z0-9_-]{6,120}$/.test(actor.id) ||
    typeof actor.email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(actor.email) ||
    typeof actor.authSupabaseId !== "string" || !UUID_PATTERN.test(actor.authSupabaseId) ||
    !Number.isSafeInteger(actor.authVerifiedAt) ||
    actor.authVerifiedAt > nowMs + 30_000 || actor.authVerifiedAt < nowMs - 5 * 60_000
  ) deny("GPT02_OWNER_GOOGLE_SUPERADMIN_SESSION_REQUIRED");
}

export function assertExactGpt02RelockManifestScope(
  manifest: Gpt02RelockManifest,
  actor: Gpt02OwnerActor,
  nowMs: number,
): void {
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
  ) deny("GPT02_OWNER_APPROVAL_MANIFEST_SCOPE_INVALID");
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
  approvalMethod: "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION";
  expiresAt: string;
}> {
  const nowMs = input.nowMs ?? Date.now();
  assertActorShape(input.actor, nowMs);
  if (typeof input.verifyOwner !== "function" || await input.verifyOwner(input.actor) !== true) {
    deny("GPT02_OWNER_IDENTITY_NOT_ELIGIBLE");
  }

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
    timer: { unit: "gpt02-issue159-relock-catalog-auditor.timer", finalActiveState: "inactive", finalUnitFileState: "disabled" } as const,
    service: { unit: "gpt02-issue159-relock-catalog-auditor.service", finalActiveState: "inactive", finalMainPid: 0 } as const,
    credential: {
      source: "/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn",
      regularFile: true, symlink: false, mode: "0600", owner: "root", group: "root",
      contentRead: false, decrypted: false,
    } as const,
    operations: [
      "DISABLE_ISSUE159_TIMER",
      "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL",
      "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD",
    ] as const,
    preconditions: { rolesFound: 4, activeSessions: 0, openWatchdogRows: 0, serviceIdle: true, noConcurrentSupervisorRun: true } as const,
    postconditions: { allRoleInvariantsPass: true, activeSessions: 0, openWatchdogRows: 0, timerInactiveDisabled: true, serviceIdle: true, credentialMetadataPass: true } as const,
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

  await db.execute(sql`
    UPDATE gpt02_owner_approval.gpt02_relock_owner_approval_challenges
    SET status = 'EXPIRED'
    WHERE scope = ${GPT02_RELOCK_SCOPE}
      AND status = 'PENDING'
      AND expires_at <= NOW()
  `);
  await db.execute(sql`
    INSERT INTO gpt02_owner_approval.gpt02_relock_owner_approval_challenges (
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
    approvalMethod: "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION",
    expiresAt: new Date(manifest.expiresAt).toISOString(),
  };
}

export async function verifyAndRecordGpt02RelockOwnerApproval(input: {
  actor: Gpt02OwnerActor;
  verifyOwner: Gpt02OwnerVerifier;
  challengeId: string;
  manifestSha256: string;
  signedSessionSha256: string;
  nowMs?: number;
}): Promise<{
  recorded: true;
  ownerSessionCryptographicallyVerified: true;
  explicitOwnerDecision: "APPROVE";
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
  if (!UUID_PATTERN.test(input.challengeId) || !HEX_SHA256_PATTERN.test(input.manifestSha256) ||
      !HEX_SHA256_PATTERN.test(input.signedSessionSha256)) {
    deny("GPT02_OWNER_APPROVAL_SUBMISSION_INVALID");
  }

  const result = await db.execute(sql`
    SELECT id, owner_subject, owner_auth_supabase_id, owner_email, manifest_json,
           manifest_sha256, nonce_hash, expires_at, status
    FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges
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
  assertExactGpt02RelockManifestScope(manifest, input.actor, nowMs);
  const canonicalPayload = canonicalizeGpt02RelockManifest(manifest);
  const digest = sha256(canonicalPayload);
  if (digest !== row.manifest_sha256 || digest !== input.manifestSha256 || !HEX_SHA256_PATTERN.test(digest)) {
    deny("GPT02_OWNER_APPROVAL_MANIFEST_DIGEST_MISMATCH");
  }
  const nonceHash = sha256(manifest.nonce);
  if (nonceHash !== row.nonce_hash || manifest.expiresAt <= nowMs || manifest.issuedAt > nowMs + 30_000) {
    deny("GPT02_OWNER_APPROVAL_NONCE_OR_TIME_INVALID");
  }

  await db.transaction(async (tx) => {
    const consumed = await tx.execute(sql`
      UPDATE gpt02_owner_approval.gpt02_relock_owner_approval_challenges
      SET status = 'CONSUMED', consumed_at = NOW()
      WHERE id = ${input.challengeId}::uuid
        AND status = 'PENDING'
        AND expires_at > NOW()
        AND owner_subject = ${`owner:${input.actor.id}`}
        AND owner_auth_supabase_id = ${input.actor.authSupabaseId}::uuid
        AND manifest_sha256 = ${digest}
        AND nonce_hash = ${nonceHash}
      RETURNING id
    `);
    if (!Array.isArray(consumed.rows) || consumed.rows.length !== 1) {
      deny("GPT02_OWNER_APPROVAL_NONCE_REPLAY_OR_RACE");
    }
    await tx.execute(sql`
      INSERT INTO gpt02_owner_approval.gpt02_relock_owner_approval_decisions (
        challenge_id, scope, owner_subject, owner_auth_supabase_id, owner_email,
        worker_principal, manifest_sha256, signed_session_sha256, approval_method,
        decision, decided_at
      ) VALUES (
        ${input.challengeId}::uuid, ${GPT02_RELOCK_SCOPE}, ${`owner:${input.actor.id}`},
        ${input.actor.authSupabaseId}::uuid, ${input.actor.email.toLowerCase()},
        ${GPT02_RELOCK_WORKER_ID}, ${digest}, ${input.signedSessionSha256},
        'FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION', 'APPROVED', NOW()
      )
    `);
  });

  return {
    recorded: true,
    ownerSessionCryptographicallyVerified: true,
    explicitOwnerDecision: "APPROVE",
    executionPermitted: false,
    signingPermitted: false,
    dispatchPermitted: false,
    releaseDecision: "NO_GO",
    manifestSha256: digest,
  };
}
