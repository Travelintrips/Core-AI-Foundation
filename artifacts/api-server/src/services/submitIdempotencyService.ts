/**
 * submitIdempotencyService — DB-backed idempotency for customer project submission.
 *
 * Provides a persistent, concurrency-safe dedup table (ai_submit_idempotency)
 * so duplicate POSTs to /api/public/customer/submit return the same canonical
 * project response — even across multiple workers, server restarts, or
 * horizontal scale-out.
 *
 * The in-memory Map in customer-portal.ts stays as a fast L1 guard within
 * a single process (sub-millisecond). This table is the authoritative L2.
 *
 * Table: ai_platform.ai_submit_idempotency
 *   fingerprint   TEXT PRIMARY KEY  — SHA-256(email|brandName|businessType)
 *   project_id    TEXT              — UUID of the created project (null while in-flight)
 *   response_data JSONB             — serialised 201 payload (empty object while in-flight)
 *   created_at    TIMESTAMPTZ       — record creation time
 *   expires_at    TIMESTAMPTZ       — TTL; expired records may be purged on startup
 *
 * Concurrency flow:
 *   1. claimFingerprint(fp, expiresAt)
 *        { claimed: true }                    → we own the slot; proceed with creation
 *        { claimed: false, responseData: {...} } → duplicate; return stored response
 *        { claimed: false, inFlight: true }   → first req still processing; 409 to caller
 *   2. commitFingerprint(fp, projectId, responseData) — persists final 201 payload
 *   3. releaseFingerprint(fp)                 — deletes slot on creation failure (allow retry)
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface IdempotencyClaimResult {
  claimed: boolean;
  inFlight?: boolean;
  responseData?: Record<string, unknown>;
}

/**
 * Idempotent DDL: creates ai_submit_idempotency table + index if absent.
 * Called once at server startup inside app.listen(). Never throws.
 */
export async function ensureSubmitIdempotencyTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_submit_idempotency (
        fingerprint   TEXT PRIMARY KEY,
        project_id    TEXT,
        response_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at    TIMESTAMPTZ NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_submit_idempotency_expires_at_idx
        ON ai_platform.ai_submit_idempotency (expires_at)
    `);
    // Purge expired rows on startup (best-effort)
    await db.execute(sql`
      DELETE FROM ai_platform.ai_submit_idempotency WHERE expires_at < NOW()
    `);
    logger.info("[submit-idempotency] Table ensured");
  } catch (err) {
    logger.warn({ err }, "[submit-idempotency] Startup table ensure failed (non-blocking)");
  }
}

/**
 * Atomically claim a fingerprint slot in the DB.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING so only one racing caller succeeds —
 * no external locks, no SELECT-then-INSERT races.
 *
 * Returns:
 *   { claimed: true }                          — caller owns the slot; proceed
 *   { claimed: false, responseData }           — duplicate; return stored payload
 *   { claimed: false, inFlight: true }         — first request still creating; caller should 409
 */
export async function claimFingerprint(
  fingerprint: string,
  expiresAt: Date,
): Promise<IdempotencyClaimResult> {
  try {
    // Atomic INSERT — if fingerprint already exists the row is silently skipped
    const result = await db.execute(sql`
      INSERT INTO ai_platform.ai_submit_idempotency (fingerprint, response_data, expires_at)
      VALUES (${fingerprint}, '{}'::jsonb, ${expiresAt.toISOString()}::timestamptz)
      ON CONFLICT (fingerprint) DO NOTHING
      RETURNING fingerprint
    `);

    const inserted = Array.isArray(result.rows) && result.rows.length > 0;
    if (inserted) {
      return { claimed: true };
    }

    // Conflict — read existing record to decide what to return
    const existing = await db.execute(sql`
      SELECT response_data
      FROM ai_platform.ai_submit_idempotency
      WHERE fingerprint = ${fingerprint} AND expires_at > NOW()
    `);

    if (!Array.isArray(existing.rows) || existing.rows.length === 0) {
      // Record expired between the conflict and our SELECT — clean up and retry once
      await db.execute(sql`
        DELETE FROM ai_platform.ai_submit_idempotency WHERE fingerprint = ${fingerprint}
      `).catch(() => {});
      return claimFingerprint(fingerprint, expiresAt);
    }

    const row = existing.rows[0] as { response_data: Record<string, unknown> | null };
    const data = row.response_data;
    if (data && typeof data === "object" && Object.keys(data).length > 0) {
      // First request has already committed — return its canonical response
      return { claimed: false, responseData: data };
    }

    // Row exists but response_data is still empty — first request is in-flight
    return { claimed: false, inFlight: true };
  } catch (err) {
    // If DB is unavailable, degrade gracefully: let the request through
    logger.warn({ err }, "[submit-idempotency] claimFingerprint DB error — degrading to allow");
    return { claimed: true };
  }
}

/**
 * Commit the final 201 response to the idempotency record.
 * Called after successful project creation. Never throws.
 */
export async function commitFingerprint(
  fingerprint: string,
  projectId: string,
  responseData: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE ai_platform.ai_submit_idempotency
      SET project_id    = ${projectId},
          response_data = ${JSON.stringify(responseData)}::jsonb
      WHERE fingerprint = ${fingerprint}
    `);
  } catch (err) {
    logger.warn({ err }, "[submit-idempotency] commitFingerprint failed (non-blocking)");
  }
}

/**
 * Release a fingerprint when project creation failed, so the next retry
 * gets a fresh slot. Never throws.
 */
export async function releaseFingerprint(fingerprint: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM ai_platform.ai_submit_idempotency WHERE fingerprint = ${fingerprint}
    `);
  } catch (err) {
    logger.warn({ err }, "[submit-idempotency] releaseFingerprint failed (non-blocking)");
  }
}
