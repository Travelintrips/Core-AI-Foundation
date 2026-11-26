/**
 * Issue238 source-only origin verifier. No database writes or dispatch.
 *
 * A future dedicated issuer must first establish the task/command relation
 * from a trusted, durable, non-generic reservation. NEVER derive that relation
 * from the Owner form, request JSON, or a claimed worker identity.
 */
import { createHash, createPublicKey, verify } from "node:crypto";

const PURPOSE = "issue238-pg17-disposable-qa";
const WORKER = "openclaw-vps-main";
const PROJECT = "xssrfshdrtdfupgqwfdw";
const SQL_SHA = "0c7815ee6e9ffc9950ee1d7e5680e6debf8e11cd840074dd2991ec49fe6d79c4";
const IMAGE_SHA = "d9e2aef79dfb5d2737351a0010bb9d645726b331d42d4e25b87b31cff85d58d7";
// Exact SHA256 of the trusted BizPortal DEV Ed25519 PEM as enrolled in the
// existing, purpose-scoped on-host Issue238 issuer. Public key only.
export const ISSUE238_OWNER_PUBLIC_PEM_SHA256 =
  "d63168300bd7557f38670cb820b3f0536c5b3c7ab2d82c6a7097f34766ac9fef";

export const ISSUE238_QA_TESTS = Object.freeze([
  "issue238-pg17-lock-expiry-concurrency-qa.sh",
  "issue238-pgcron164-nonsuperuser-crash-qa.sh",
  "issue238-pgcron164-scheduler-crash-qa.sh",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NONCE = /^NONCE-[a-f0-9]{32}$/;
const EXPECTED_FIELDS = Object.freeze([
  "command_id","job_id","nonce","worker_id","operation","environment",
  "project_ref","sql_sha256","image_sha256","test","issued_at","expires_at",
]);

export class Issue238OriginDenied extends Error {
  constructor(message: string) { super(message); this.name = "Issue238OriginDenied"; }
}
type StringClaims = Record<string, unknown>;
export type Issue238Origin = Readonly<{
  commandId: string; jobId: string; nonce: string; selectedTest: string;
  ownerApprovalExpiresAt: number; verifiedOwnerSignature: true;
}>;
export type TrustedReservedPair = Readonly<{
  // These MUST come from a separately authenticated, authoritative AI Core
  // stage lookup, not request claims, a generic bridge claim or an agent token.
  commandId: string;
  jobId: string;
  source: "issue238-dedicated-owner-stage";
  state: "AWAITING_OWNER_APPROVAL";
}>;
export type OwnerRequest = { claims: unknown; owner_signature: unknown };

function fail(reason: string): never { throw new Issue238OriginDenied(reason); }
function canonical(value: StringClaims): Buffer {
  // Matches the existing BizPortal DEV and host issuer's sorted-key JSON.
  return Buffer.from(JSON.stringify(Object.fromEntries(
    Object.keys(value).sort().map(key => [key, value[key]]),
  )), "ascii");
}

export function verifyIssue238OwnerOrigin(
  ownerRequest: unknown,
  trustedReservation: TrustedReservedPair | null,
  trustedOwnerPublicPem: string,
  opts: { nowSeconds: number; expectedPublicPemSha256?: string },
): Issue238Origin {
  if (!trustedReservation || trustedReservation.source !== "issue238-dedicated-owner-stage" ||
      trustedReservation.state !== "AWAITING_OWNER_APPROVAL" ||
      !UUID.test(trustedReservation.commandId) || !UUID.test(trustedReservation.jobId)) {
    fail("AUTHORITATIVE_RESERVED_PAIR_REQUIRED");
  }
  if (!ownerRequest || typeof ownerRequest !== "object" || Array.isArray(ownerRequest) ||
      Object.keys(ownerRequest).sort().join(",") !== "claims,owner_signature") {
    fail("EXACT_OWNER_REQUEST_REQUIRED");
  }
  const request = ownerRequest as OwnerRequest;
  if (!request.claims || typeof request.claims !== "object" || Array.isArray(request.claims)) {
    fail("CLAIMS_REQUIRED");
  }
  const claims = request.claims as StringClaims;
  if (Object.keys(claims).sort().join(",") !== [...EXPECTED_FIELDS].sort().join(",")) {
    fail("UNREVIEWED_CLAIMS");
  }
  for (const [key, value] of Object.entries({
    worker_id:WORKER, operation:PURPOSE, environment:"dev",
    project_ref:PROJECT, sql_sha256:SQL_SHA, image_sha256:IMAGE_SHA,
  })) {
    if (claims[key] !== value) fail("OUT_OF_SCOPE_"+key);
  }
  if (claims.command_id !== trustedReservation.commandId ||
      claims.job_id !== trustedReservation.jobId ||
      typeof claims.command_id !== "string" || !UUID.test(claims.command_id) ||
      typeof claims.job_id !== "string" || !UUID.test(claims.job_id)) {
    fail("AUTHENTICATED_JOB_PAIR_MISMATCH");
  }
  if (typeof claims.nonce !== "string" || !NONCE.test(claims.nonce)) fail("INVALID_NONCE");
  if (typeof claims.test !== "string" || !ISSUE238_QA_TESTS.includes(claims.test)) {
    fail("UNLISTED_QA_TEST");
  }
  const now = opts?.nowSeconds;
  if (!Number.isSafeInteger(now) ||
      !Number.isSafeInteger(claims.issued_at) ||
      !Number.isSafeInteger(claims.expires_at)) fail("INVALID_TIMESTAMPS");
  const issued = claims.issued_at as number;
  const expires = claims.expires_at as number;
  if (issued < now - 60 || issued > now || expires <= now ||
      expires !== issued + 90) fail("OWNER_APPROVAL_EXPIRED");
  if (typeof trustedOwnerPublicPem !== "string" ||
      createHash("sha256").update(trustedOwnerPublicPem, "utf8").digest("hex") !==
        (opts.expectedPublicPemSha256 ?? ISSUE238_OWNER_PUBLIC_PEM_SHA256)) {
    fail("UNTRUSTED_OWNER_PUBLIC_KEY");
  }
  if (typeof request.owner_signature !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(request.owner_signature)) {
    fail("INVALID_OWNER_SIGNATURE");
  }
  try {
    const publicKey = createPublicKey(trustedOwnerPublicPem);
    if (publicKey.asymmetricKeyType !== "ed25519" ||
        !verify(null, canonical(claims), publicKey,
          Buffer.from(request.owner_signature, "base64"))) fail("OWNER_SIGNATURE_NOT_VERIFIED");
  } catch (error) {
    if (error instanceof Issue238OriginDenied) throw error;
    fail("OWNER_SIGNATURE_NOT_VERIFIED");
  }
  return Object.freeze({
    commandId:trustedReservation.commandId,
    jobId:trustedReservation.jobId,
    nonce:claims.nonce,
    selectedTest:claims.test,
    ownerApprovalExpiresAt:expires,
    verifiedOwnerSignature:true as const,
  });
}
