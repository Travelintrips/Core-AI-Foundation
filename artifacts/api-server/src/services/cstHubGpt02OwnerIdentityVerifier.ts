import type {
  Gpt02OwnerActor,
} from "./gpt02RelockOwnerApprovalService.js";

const CST_HUB_ORIGIN = "https://dev-ai-task.cstlogistic.co.id";
const SESSION_READINESS_PATH = "/api/auth/gpt02/operator-session-readiness";
// This is strictly the read-only Owner identity-link verifier. It does not
// read or create any Task #183 approval/consent/nonce/recovery decision.
const OWNER_LINK_READINESS_PATH = "/api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default";
const MAX_RESPONSE_BYTES = 8_192;
const REQUEST_TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type Gpt02HubOwnerSessionInput = Readonly<{
  bearerToken: string;
}>;

function deny(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSessionClaims(token: string, nowMs: number): Gpt02OwnerActor {
  if (token.length < 48 || token.length > 4_096 || /\s/.test(token)) {
    deny("GPT02_HUB_OWNER_SESSION_TOKEN_INVALID");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))) {
    deny("GPT02_HUB_OWNER_SESSION_TOKEN_INVALID");
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    deny("GPT02_HUB_OWNER_SESSION_CLAIMS_INVALID");
  }
  if (!isRecord(claims)) deny("GPT02_HUB_OWNER_SESSION_CLAIMS_INVALID");

  const actor: Gpt02OwnerActor = {
    id: String(claims.id ?? ""),
    role: String(claims.role ?? ""),
    companyId: claims.companyId === null ? null : String(claims.companyId ?? ""),
    email: String(claims.email ?? ""),
    authSource: String(claims.authSource ?? ""),
    authSupabaseId: String(claims.authSupabaseId ?? ""),
    authVerifiedAt: Number(claims.authVerifiedAt),
  };
  const expiresAt = Number(claims.exp);
  if (
    !/^google_[A-Za-z0-9_-]{6,120}$/.test(actor.id) ||
    actor.role !== "super_admin" ||
    !(actor.companyId === null || actor.companyId === "default") ||
    !/^[^@\s]+@[^@\s]+$/.test(actor.email) ||
    actor.authSource !== "supabase_google_identity" ||
    !UUID_PATTERN.test(actor.authSupabaseId) ||
    !Number.isSafeInteger(actor.authVerifiedAt) ||
    actor.authVerifiedAt > nowMs + 30_000 ||
    actor.authVerifiedAt < nowMs - 5 * 60_000 ||
    !Number.isSafeInteger(expiresAt) || expiresAt * 1_000 <= nowMs
  ) {
    deny("GPT02_HUB_OWNER_GOOGLE_SESSION_NOT_FRESH_SUPERADMIN");
  }
  return actor;
}

async function getHubJson(path: string, bearerToken: string): Promise<Record<string, unknown>> {
  const url = new URL(path, CST_HUB_ORIGIN);
  if (url.origin !== CST_HUB_ORIGIN) deny("GPT02_HUB_OWNER_VERIFIER_ORIGIN_INVALID");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    deny("GPT02_HUB_OWNER_VERIFIER_UNAVAILABLE");
  }
  if (!response!.ok) {
    if (response!.status === 401 || response!.status === 403) {
      deny("GPT02_HUB_OWNER_SESSION_OR_IDENTITY_REJECTED");
    }
    if (response!.status === 410) {
      deny("GPT02_HUB_OWNER_LINK_VERIFIER_RETIRED");
    }
    deny("GPT02_HUB_OWNER_VERIFIER_UNAVAILABLE");
  }
  const contentType = response!.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    deny("GPT02_HUB_OWNER_VERIFIER_RESPONSE_INVALID");
  }
  const contentLength = Number(response!.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    deny("GPT02_HUB_OWNER_VERIFIER_RESPONSE_TOO_LARGE");
  }
  if (!response!.body) deny("GPT02_HUB_OWNER_VERIFIER_RESPONSE_INVALID");

  const reader = response!.body!.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        deny("GPT02_HUB_OWNER_VERIFIER_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("GPT02_")) throw error;
    deny("GPT02_HUB_OWNER_VERIFIER_RESPONSE_INVALID");
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(body!); } catch { deny("GPT02_HUB_OWNER_VERIFIER_RESPONSE_INVALID"); }
  if (!isRecord(parsed)) deny("GPT02_HUB_OWNER_VERIFIER_RESPONSE_INVALID");
  return parsed!;
}

export async function verifyCstHubGpt02OwnerSession(
  input: Gpt02HubOwnerSessionInput,
): Promise<Gpt02OwnerActor> {
  const readiness = await getHubJson(SESSION_READINESS_PATH, input.bearerToken);
  if (
    readiness.googleProofFresh !== true ||
    readiness.googleProofStatus !== "SIGNED_SESSION_GOOGLE_PROOF_FRESH" ||
    readiness.requiresFreshGoogleLogin !== false ||
    readiness.proofSource !== "signed_app_session" ||
    readiness.readOnly !== true ||
    readiness.operatorApprovalRecorded !== false ||
    readiness.commandBoundConsentVerified !== false ||
    readiness.issuerLeaseGranted !== false ||
    readiness.dispatchPermitted !== false ||
    readiness.resumePermitted !== false ||
    readiness.statusChanged !== false
  ) {
    deny("GPT02_HUB_OWNER_GOOGLE_SESSION_NOT_FRESH");
  }
  // The Hub has already verified the signature of this exact bearer token and
  // its fresh Google Super Admin claims. The payload is only decoded locally
  // after that server-side verification; it is never accepted from request JSON.
  return parseSessionClaims(input.bearerToken, Date.now());
}

export async function verifyCstHubGpt02OwnerLink(
  actor: Gpt02OwnerActor,
  bearerToken: string,
): Promise<boolean> {
  try {
    const identity = await getHubJson(OWNER_LINK_READINESS_PATH, bearerToken);
    return identity.eligible === true &&
      identity.taskId === 183 &&
      identity.companyId === "default" &&
      identity.scope === "SUPERADMIN_OWNER_IDENTITY_READ_ONLY" &&
      identity.ownerSubject === `owner:${actor.id}` &&
      identity.googleSessionVerified === true &&
      identity.enabledOperatorLinkVerified === true &&
      identity.approvalDecisionCreated === false &&
      identity.cryptographicOwnerSignatureVerified === false &&
      identity.issuerAuthorized === false &&
      identity.dispatchPermitted === false &&
      identity.readOnly === true;
  } catch (error) {
    if (error instanceof Error && error.message === "GPT02_HUB_OWNER_SESSION_OR_IDENTITY_REJECTED") {
      return false;
    }
    throw error;
  }
}
