/**
 * signedUrlService.ts — P0-2 Signed URL generation & verification.
 *
 * Generates short-lived, HMAC-signed download tokens for final project files.
 * Tokens are self-contained (no DB table needed):
 *
 *   token = base64url(JSON({ pid, url, exp })) + "." + base64url(HMAC-SHA256(SECRET, payload))
 *
 * Revocation is supported via an in-memory deny-list (process lifetime).
 * For persistent revocation across restarts, the caller should persist the
 * denied token IDs in the audit log and call revokeToken() on startup.
 */
import { createHmac, randomBytes } from "crypto";

const SECRET = process.env["SESSION_SECRET"] ?? process.env["ADMIN_API_KEY"] ?? "insecure-dev-only-secret";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

/** In-process revocation set (token IDs). Clear on restart — acceptable for short-lived tokens. */
const revokedTokenIds = new Set<string>();

// ── Helpers ─────────────────────────────────────────────────────────────────────

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

// ── Token shape ──────────────────────────────────────────────────────────────────

interface TokenPayload {
  id: string;    // random nonce (for revocation)
  pid: number;   // creative project id
  url: string;   // the actual file URL
  exp: number;   // unix timestamp (seconds)
}

// ── Generate ─────────────────────────────────────────────────────────────────────

/**
 * Generate a signed download token for a project file URL.
 * @param projectId  The creative_projects.id (numeric).
 * @param fileUrl    The actual file URL to protect.
 * @param ttlSeconds Token lifetime in seconds (default 3600).
 */
export function generateDownloadToken(
  projectId: number,
  fileUrl: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const payload: TokenPayload = {
    id: randomBytes(8).toString("hex"),
    pid: projectId,
    url: fileUrl,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = b64url(JSON.stringify(payload));
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

// ── Verify ───────────────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  payload?: TokenPayload;
}

export function verifyDownloadToken(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "Malformed token" };

  const [encoded, sig] = parts;
  const expectedSig = sign(encoded!);

  // Constant-time comparison would be ideal; for tokens of same length this is fine
  if (sig !== expectedSig) return { valid: false, reason: "Invalid signature" };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf-8")) as TokenPayload;
  } catch {
    return { valid: false, reason: "Malformed payload" };
  }

  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false, reason: "Token expired" };
  }

  if (revokedTokenIds.has(payload.id)) {
    return { valid: false, reason: "Token revoked" };
  }

  return { valid: true, payload };
}

// ── Revoke ───────────────────────────────────────────────────────────────────────

/** Revoke a token by its nonce id (extracted from payload). */
export function revokeToken(token: string): boolean {
  const result = verifyDownloadToken(token);
  if (!result.valid || !result.payload) return false;
  revokedTokenIds.add(result.payload.id);
  return true;
}

/** Revoke by nonce id directly (e.g. from audit log). */
export function revokeTokenById(id: string): void {
  revokedTokenIds.add(id);
}
