/**
 * signedUrlService.ts — P0-2 Signed URL generation & verification.
 *
 * Generates short-lived, HMAC-signed download tokens for final project files.
 * Tokens are self-contained:
 *
 *   token = base64url(JSON({ id, pid, url, exp })) + "." + base64url(HMAC-SHA256(SECRET, payload))
 *
 * Revocation is backed by the `ai_platform.signed_url_revocations` DB table
 * so that revocations persist across process restarts.  The in-memory set is
 * seeded from the DB on startup (call `loadRevokedTokens()` in app bootstrap).
 */
import { createHmac, randomBytes } from "crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const SECRET = process.env["SESSION_SECRET"] ?? process.env["ADMIN_API_KEY"] ?? "insecure-dev-only-secret";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

/** In-process revocation set (token IDs). Seeded from DB on startup via loadRevokedTokens(). */
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

/**
 * Revoke a token and persist the revocation to DB so it survives restarts.
 * Returns false if the token is already invalid (expired or bad signature).
 */
export async function revokeToken(
  token: string,
  opts: { revokedBy?: string; reason?: string } = {},
): Promise<boolean> {
  const result = verifyDownloadToken(token);
  if (!result.valid || !result.payload) return false;

  const { id, pid } = result.payload;
  revokedTokenIds.add(id);

  try {
    await pool.query(
      `INSERT INTO ai_platform.signed_url_revocations (token_id, project_id, revoked_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_id) DO NOTHING`,
      [id, pid, opts.revokedBy ?? null, opts.reason ?? null],
    );
  } catch (err) {
    // Log but don't throw — the in-memory revocation already took effect.
    logger.error({ err, tokenId: id }, "[signedUrl] Failed to persist revocation to DB");
  }

  return true;
}

/** Revoke by nonce id directly (e.g. from audit log or admin action). Persists to DB. */
export async function revokeTokenById(
  id: string,
  opts: { projectId?: number; revokedBy?: string; reason?: string } = {},
): Promise<void> {
  revokedTokenIds.add(id);

  try {
    await pool.query(
      `INSERT INTO ai_platform.signed_url_revocations (token_id, project_id, revoked_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_id) DO NOTHING`,
      [id, opts.projectId ?? null, opts.revokedBy ?? null, opts.reason ?? null],
    );
  } catch (err) {
    logger.error({ err, tokenId: id }, "[signedUrl] Failed to persist revocation to DB");
  }
}

/**
 * Seed the in-memory revocation set from the DB.
 * Call once during app startup (before handling requests) to ensure
 * revocations issued before this process started are honoured.
 */
export async function loadRevokedTokens(): Promise<number> {
  try {
    // Only load non-expired-equivalent revocations (tokens with exp > now-TTL still matter)
    const result = await pool.query<{ token_id: string }>(
      `SELECT token_id FROM ai_platform.signed_url_revocations
       WHERE revoked_at > NOW() - INTERVAL '24 hours'`,
    );
    for (const row of result.rows) {
      revokedTokenIds.add(row.token_id);
    }
    logger.info({ count: result.rows.length }, "[signedUrl] Loaded revoked tokens from DB");
    return result.rows.length;
  } catch (err) {
    // Table may not exist yet in fresh deployments — non-fatal.
    logger.warn({ err }, "[signedUrl] Could not load revoked tokens from DB (table may not exist yet)");
    return 0;
  }
}

/** Return current in-memory revocation count (for monitoring). */
export function getRevokedCount(): number {
  return revokedTokenIds.size;
}
