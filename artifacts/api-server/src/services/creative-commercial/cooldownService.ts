/**
 * creative-commercial/cooldownService.ts — Team 03
 *
 * Idempotency + cooldown guard for recommendations.
 * Uses cc_recommendation_log table (see integration/migrations/team-03.sql).
 *
 * Rules:
 *   - Same (customerProfileId, recType, contextKey) within cooldown window → blocked
 *   - Idempotent: second call in same window returns existing entry, not an error
 *   - Cooldown windows defined in types.ts COOLDOWN_HOURS
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { type RecommendationType, COOLDOWN_HOURS } from "./types.js";

// ── Raw-SQL helpers (new team-03 table, not in shared barrel) ─────────────────

type LogRow = {
  id: number;
  customer_profile_id: number;
  rec_type: string;
  context_key: string;
  cooldown_until: string;
  created_at: string;
} & Record<string, unknown>;

/** Returns the active cooldown entry if blocked, null if clear to proceed. */
export async function checkCooldown(opts: {
  customerProfileId: number;
  recType: RecommendationType;
  contextKey: string;
}): Promise<{ blocked: boolean; cooldownUntil?: Date }> {
  const result = await db.execute<LogRow>(sql`
    SELECT id, cooldown_until
    FROM ai_platform.cc_recommendation_log
    WHERE customer_profile_id = ${opts.customerProfileId}
      AND rec_type            = ${opts.recType}
      AND context_key         = ${opts.contextKey}
      AND cooldown_until      > now()
    ORDER BY cooldown_until DESC
    LIMIT 1
  `);

  const rows = (result as unknown as { rows: LogRow[] }).rows ?? [];
  if (rows.length === 0) return { blocked: false };
  return { blocked: true, cooldownUntil: new Date(rows[0].cooldown_until) };
}

/**
 * Records a recommendation delivery and sets the cooldown window.
 * Idempotent: if the same combo is already recorded in the window, the
 * existing row is returned without inserting a duplicate.
 */
export async function recordRecommendation(opts: {
  customerProfileId: number;
  recType: RecommendationType;
  contextKey: string;
  payloadJson?: Record<string, unknown>;
}): Promise<{ id: number; cooldownUntil: Date; alreadyExisted: boolean }> {
  const cooldownHours = COOLDOWN_HOURS[opts.recType];

  // Check first (idempotency)
  const existing = await db.execute<LogRow>(sql`
    SELECT id, cooldown_until
    FROM ai_platform.cc_recommendation_log
    WHERE customer_profile_id = ${opts.customerProfileId}
      AND rec_type            = ${opts.recType}
      AND context_key         = ${opts.contextKey}
      AND cooldown_until      > now()
    LIMIT 1
  `);
  const existingRows = (existing as unknown as { rows: LogRow[] }).rows ?? [];
  if (existingRows.length > 0) {
    return {
      id: existingRows[0].id,
      cooldownUntil: new Date(existingRows[0].cooldown_until),
      alreadyExisted: true,
    };
  }

  const inserted = await db.execute<LogRow>(sql`
    INSERT INTO ai_platform.cc_recommendation_log
      (customer_profile_id, rec_type, context_key, payload_json, cooldown_until)
    VALUES (
      ${opts.customerProfileId},
      ${opts.recType},
      ${opts.contextKey},
      ${JSON.stringify(opts.payloadJson ?? {})}::jsonb,
      now() + ${cooldownHours} * interval '1 hour'
    )
    RETURNING id, cooldown_until
  `);
  const insertedRows = (inserted as unknown as { rows: LogRow[] }).rows ?? [];
  return {
    id: insertedRows[0].id,
    cooldownUntil: new Date(insertedRows[0].cooldown_until),
    alreadyExisted: false,
  };
}

/** Clears all active cooldowns for a customer (admin/test use only). */
export async function clearCooldowns(customerProfileId: number): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    DELETE FROM ai_platform.cc_recommendation_log
    WHERE customer_profile_id = ${customerProfileId}
    RETURNING id
  `);
  const rows = (result as unknown as { rows: unknown[] }).rows ?? [];
  return rows.length;
}

/** Returns recent log entries for a customer (admin debugging). */
export async function getRecommendationLog(
  customerProfileId: number,
  limit = 50,
): Promise<LogRow[]> {
  const result = await db.execute<LogRow>(sql`
    SELECT *
    FROM ai_platform.cc_recommendation_log
    WHERE customer_profile_id = ${customerProfileId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return (result as unknown as { rows: LogRow[] }).rows ?? [];
}
