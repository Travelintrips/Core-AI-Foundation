/**
 * signedUrlRevocationStore.ts — Persistent revocation store for signed download tokens.
 *
 * Provides DB-backed persistence so revocations survive process restarts.
 * Uses the ai_platform.signed_url_revocations table via raw SQL (no drizzle-orm).
 */
import { pool } from "@workspace/db";

// ── Table management ─────────────────────────────────────────────────────────

/**
 * Creates the revocation table if it does not already exist.
 * Call once on application startup before handling requests.
 */
export async function ensureRevocationTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_platform.signed_url_revocations (
      token_id   TEXT PRIMARY KEY,
      project_id INT,
      revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `);
}

// ── Write operations ─────────────────────────────────────────────────────────

/**
 * Persists a revoked token ID to the DB.
 * Silently ignores duplicate inserts (ON CONFLICT DO NOTHING).
 */
export async function persistRevocation(
  tokenId: string,
  projectId?: number,
  expiresAt?: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO ai_platform.signed_url_revocations (token_id, project_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_id) DO NOTHING`,
    [tokenId, projectId ?? null, expiresAt ?? null],
  );
}

/**
 * Deletes all revocation records whose expires_at is in the past.
 * Safe to call periodically to keep the table small.
 */
export async function pruneExpiredRevocations(): Promise<void> {
  await pool.query(
    `DELETE FROM ai_platform.signed_url_revocations
     WHERE expires_at IS NOT NULL AND expires_at < NOW()`,
  );
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Checks whether a specific token ID is revoked in the DB.
 * Treats expired revocation records as still revoked (they haven't been pruned yet).
 */
export async function isRevokedInDb(tokenId: string): Promise<boolean> {
  const result = await pool.query<{ token_id: string }>(
    `SELECT token_id FROM ai_platform.signed_url_revocations WHERE token_id = $1`,
    [tokenId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Loads all non-expired revoked token IDs from the DB.
 * Used on startup to warm the in-memory deny-list.
 * Records with NULL expires_at (no expiry) are always returned.
 */
export async function loadRevokedIds(): Promise<string[]> {
  const result = await pool.query<{ token_id: string }>(
    `SELECT token_id FROM ai_platform.signed_url_revocations
     WHERE expires_at IS NULL OR expires_at > NOW()`,
  );
  return result.rows.map((r) => r.token_id);
}
