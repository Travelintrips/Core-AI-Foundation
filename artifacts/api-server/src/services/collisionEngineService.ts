/**
 * WP-03B — Collision Engine Service
 *
 * Loads session and placement data from the DB (WP-03A repository),
 * enforces tenant context, then delegates to the pure collision engine.
 *
 * Security requirements:
 * - tenantId always comes from trusted context — NEVER from body/query
 * - Archived placements excluded from all collision checks
 * - No SQL details in error messages
 * - No stack traces in API responses
 */

import { db } from "@workspace/db";
import {
  layoutSessionsTable,
  placementsTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { PlacementEngineError } from "./placementEngineService.js";
import type { PlacementGeometry, RoomBounds, CollisionResult } from "./collision-engine/index.js";
import {
  checkSessionCollisions,
  checkSinglePlacement,
  checkRoomBounds,
} from "./collision-engine/index.js";

// ── DB → geometry mapping ─────────────────────────────────────────────────────

function toPlacementGeometry(row: {
  id: string;
  xCm: string;
  yCm: string;
  widthCm: string;
  depthCm: string;
  rotationDeg: string;
  anchorX: string;
  anchorY: string;
  clearanceFrontCm: string;
  clearanceSideCm: string;
  clearanceBackCm: string;
  isArchived: boolean;
}): PlacementGeometry {
  return {
    id:              row.id,
    xCm:             parseFloat(row.xCm),
    yCm:             parseFloat(row.yCm),
    widthCm:         parseFloat(row.widthCm),
    depthCm:         parseFloat(row.depthCm),
    rotationDeg:     parseFloat(row.rotationDeg),
    anchorX:         parseFloat(row.anchorX),
    anchorY:         parseFloat(row.anchorY),
    clearanceFrontCm: parseFloat(row.clearanceFrontCm),
    clearanceSideCm:  parseFloat(row.clearanceSideCm),
    clearanceBackCm:  parseFloat(row.clearanceBackCm),
    isArchived:      row.isArchived,
  };
}

// ── Session + placement loader ────────────────────────────────────────────────

async function loadSessionAndPlacements(
  sessionId: string,
  tenantId:  string,
): Promise<{ room: RoomBounds; placements: PlacementGeometry[] }> {
  // Tenant-scoped session lookup
  const [session] = await db
    .select()
    .from(layoutSessionsTable)
    .where(
      and(
        eq(layoutSessionsTable.id, sessionId),
        eq(layoutSessionsTable.tenantId, tenantId),
        isNull(layoutSessionsTable.deletedAt),
      ),
    )
    .limit(1);

  if (!session) {
    throw new PlacementEngineError("Layout session not found.", "SESSION_NOT_FOUND", 404);
  }

  // Load all placements once (including archived — engine filters isArchived)
  const rows = await db
    .select()
    .from(placementsTable)
    .where(
      and(
        eq(placementsTable.sessionId, sessionId),
        eq(placementsTable.tenantId, tenantId),
      ),
    )
    .orderBy(placementsTable.id);  // deterministic order

  const room: RoomBounds = {
    widthCm: parseFloat(String(session.widthCm)),
    depthCm: parseFloat(String(session.depthCm)),
  };

  const placements = rows.map(r => toPlacementGeometry({
    id:              r.id,
    xCm:             String(r.xCm),
    yCm:             String(r.yCm),
    widthCm:         String(r.widthCm),
    depthCm:         String(r.depthCm),
    rotationDeg:     String(r.rotationDeg),
    anchorX:         String(r.anchorX),
    anchorY:         String(r.anchorY),
    clearanceFrontCm: String(r.clearanceFrontCm),
    clearanceSideCm:  String(r.clearanceSideCm),
    clearanceBackCm:  String(r.clearanceBackCm),
    isArchived:       r.isArchived,
  }));

  return { room, placements };
}

// ── Service operations ────────────────────────────────────────────────────────

/**
 * Checks all active placements in a session for collisions, boundary violations,
 * and clearance warnings.
 *
 * @param maxPlacements  Optional cap on active placements before running SAT.
 *                       If the session has more active placements than this limit,
 *                       a PLACEMENT_LIMIT_EXCEEDED error is thrown instead of
 *                       silently running an O(n²) check on an oversized session.
 */
export async function checkSessionCollisionsService(
  sessionId:     string,
  tenantId:      string,
  maxPlacements: number | undefined = undefined,
): Promise<CollisionResult> {
  const { room, placements } = await loadSessionAndPlacements(sessionId, tenantId);

  if (maxPlacements !== undefined) {
    const activeCount = placements.filter(p => !p.isArchived).length;
    if (activeCount > maxPlacements) {
      throw new PlacementEngineError(
        `Session has ${activeCount} active placements, which exceeds the limit of ${maxPlacements}.`,
        "PLACEMENT_LIMIT_EXCEEDED",
        422,
      );
    }
  }

  return checkSessionCollisions(placements, room);
}

/**
 * Checks a single placement against all others in the session.
 */
export async function checkPlacementCollisionService(
  sessionId:   string,
  placementId: string,
  tenantId:    string,
): Promise<CollisionResult> {
  const { room, placements } = await loadSessionAndPlacements(sessionId, tenantId);

  const target = placements.find(p => p.id === placementId);
  if (!target) {
    throw new PlacementEngineError("Placement not found.", "PLACEMENT_NOT_FOUND", 404);
  }

  return checkSinglePlacement(target, placements, room);
}

/**
 * Returns a collision summary for the session (same as checkSessionCollisions
 * but explicitly named for the GET endpoint).
 */
export async function getSessionCollisionSummary(
  sessionId: string,
  tenantId:  string,
): Promise<CollisionResult> {
  return checkSessionCollisionsService(sessionId, tenantId, undefined);
}

/**
 * Validates placement geometry (no DB required).
 * Used by the stateless /ai/collision/check endpoint.
 */
export function validatePlacementGeometry(
  p:    PlacementGeometry,
  room: RoomBounds,
): { valid: boolean; violation: ReturnType<typeof checkRoomBounds> } {
  const violation = checkRoomBounds(p, room);
  return { valid: violation === null, violation };
}

/**
 * Pure geometry collision check — no DB.
 * Used by the stateless POST /ai/collision/check endpoint.
 */
export function checkGeometryCollision(
  placements: PlacementGeometry[],
  room:       RoomBounds,
): CollisionResult {
  return checkSessionCollisions(placements, room);
}
