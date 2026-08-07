/**
 * WP-06A — deterministic placement rule engine.
 *
 * Candidate generation is advisory and does not persist. Apply accepts a
 * self-contained candidate id, checks the current session again, then updates
 * the existing placements row in one transaction.
 */
import { db, layoutSessionsTable, placementsTable } from "@workspace/db";
import {
  wp06aSuggestSchema,
  wp06aApplySchema,
  type Wp06aPlacementInput,
  type Wp06aCandidate,
} from "@workspace/api-zod";
import { and, eq, isNull } from "drizzle-orm";
import { checkGeometryCollision } from "./collisionEngineService.js";
import { PlacementEngineError } from "./placementEngineService.js";

const STRATEGIES = ["WALL_LEFT", "WALL_RIGHT", "WALL_TOP", "WALL_BOTTOM", "CENTER"] as const;
type Strategy = (typeof STRATEGIES)[number];

type SessionRow = typeof layoutSessionsTable.$inferSelect;
type PlacementRow = typeof placementsTable.$inferSelect;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new PlacementEngineError(`${label} must be finite.`, "VALIDATION_ERROR");
  }
  return value;
}

function parsePlacement(row: PlacementRow): Wp06aPlacementInput {
  return {
    id: row.id,
    label: row.label,
    xCm: Number(row.xCm),
    yCm: Number(row.yCm),
    widthCm: Number(row.widthCm),
    depthCm: Number(row.depthCm),
    rotationDeg: Number(row.rotationDeg),
    anchorX: Number(row.anchorX),
    anchorY: Number(row.anchorY),
    clearanceFrontCm: Number(row.clearanceFrontCm),
    clearanceSideCm: Number(row.clearanceSideCm),
    clearanceBackCm: Number(row.clearanceBackCm),
    isArchived: row.isArchived,
    version: row.version,
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function encodeCandidate(payload: Record<string, unknown>): string {
  return `wp06a.${Buffer.from(canonical(payload), "utf8").toString("base64url")}`;
}

function decodeCandidate(candidateId: string): Record<string, unknown> {
  if (!candidateId.startsWith("wp06a.")) {
    throw new PlacementEngineError("Invalid candidate.", "INVALID_CANDIDATE", 422);
  }
  try {
    const decoded = JSON.parse(Buffer.from(candidateId.slice(6), "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("not an object");
    return decoded as Record<string, unknown>;
  } catch {
    throw new PlacementEngineError("Invalid candidate.", "INVALID_CANDIDATE", 422);
  }
}

function assertSession(session: SessionRow | undefined, tenantId: string): SessionRow {
  if (!session || session.tenantId !== tenantId || session.deletedAt !== null) {
    throw new PlacementEngineError("Layout session not found.", "SESSION_NOT_FOUND", 404);
  }
  if (session.status === "archived") {
    throw new PlacementEngineError("Cannot edit an archived session.", "SESSION_ARCHIVED", 409);
  }
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  if (metadata["approvedForRendering"] === true || metadata["reviewState"] === "approved_for_rendering") {
    throw new PlacementEngineError(
      "The approved layout is immutable. Request a revision before applying changes.",
      "APPROVED_SNAPSHOT_IMMUTABLE",
      409,
    );
  }
  return session;
}

async function loadSession(sessionId: string, tenantId: string): Promise<SessionRow> {
  const [session] = await db
    .select()
    .from(layoutSessionsTable)
    .where(and(eq(layoutSessionsTable.id, sessionId), eq(layoutSessionsTable.tenantId, tenantId), isNull(layoutSessionsTable.deletedAt)))
    .limit(1);
  return assertSession(session, tenantId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function placementForStrategy(
  base: Wp06aPlacementInput,
  strategy: Strategy,
  roomWidth: number,
  roomDepth: number,
): Wp06aPlacementInput {
  const gap = Math.max(base.clearanceSideCm ?? 0, base.clearanceFrontCm ?? 0, base.clearanceBackCm ?? 0);
  const maxX = Math.max(0, roomWidth - base.widthCm);
  const maxY = Math.max(0, roomDepth - base.depthCm);
  const x = strategy === "WALL_LEFT" ? gap
    : strategy === "WALL_RIGHT" ? maxX - gap
    : strategy === "CENTER" ? (roomWidth - base.widthCm) / 2
    : clamp(base.xCm, gap, maxX - gap);
  const y = strategy === "WALL_TOP" ? gap
    : strategy === "WALL_BOTTOM" ? maxY - gap
    : strategy === "CENTER" ? (roomDepth - base.depthCm) / 2
    : clamp(base.yCm, gap, maxY - gap);

  return { ...base, xCm: finite(Math.max(0, x), "xCm"), yCm: finite(Math.max(0, y), "yCm") };
}

function scoreCandidate(
  placement: Wp06aPlacementInput,
  strategy: Strategy,
  roomWidth: number,
  roomDepth: number,
): number {
  const centerX = placement.xCm + placement.widthCm / 2;
  const centerY = placement.yCm + placement.depthCm / 2;
  const edgeDistance = Math.min(placement.xCm, placement.yCm, roomWidth - (placement.xCm + placement.widthCm), roomDepth - (placement.yCm + placement.depthCm));
  const wallScore = strategy === "CENTER" ? 20 : Math.max(0, 20 - Math.max(0, edgeDistance) / 10);
  const centerScore = strategy === "CENTER"
    ? 24
    : Math.max(0, 24 - (Math.abs(centerX - roomWidth / 2) + Math.abs(centerY - roomDepth / 2)) / 10);
  const gridScore = (Math.abs(placement.xCm % 10) < 0.001 && Math.abs(placement.yCm % 10) < 0.001) ? 18 : 8;
  const balanceScore = 20 - Math.min(20, Math.abs(centerX / roomWidth - centerY / roomDepth) * 20);
  const clearanceScore = edgeDistance >= 0 ? 18 : 0;
  return Math.max(0, Math.min(100, Number((wallScore + centerScore + gridScore + balanceScore + clearanceScore).toFixed(4))));
}

function ruleMessages(result: ReturnType<typeof checkGeometryCollision>): { hard: string[]; soft: string[] } {
  return {
    hard: [
    ...result.roomViolations.map((v) => v.message),
    ...result.physicalCollisions.map((c) => `Footprint overlaps placement ${c.idB === c.idA ? c.idA : `${c.idA} / ${c.idB}`}.`),
    ],
    soft: result.clearanceWarnings.map((w) => `Clearance ${w.side} is encroached.`),
  };
}

function candidatePayload(sessionId: string, target: Wp06aPlacementInput, strategy: Strategy): Record<string, unknown> {
  return {
    version: 1,
    sessionId,
    targetPlacementId: target.id,
    strategy,
    baseVersion: target.version ?? 1,
    base: {
      xCm: target.xCm, yCm: target.yCm, widthCm: target.widthCm, depthCm: target.depthCm,
      rotationDeg: target.rotationDeg ?? 0,
    },
  };
}

export async function suggestPlacement(
  sessionId: string,
  tenantId: string,
  input: unknown,
): Promise<{ sessionId: string; candidates: Wp06aCandidate[] }> {
  const parsed = wp06aSuggestSchema.safeParse(input);
  if (!parsed.success) {
    throw new PlacementEngineError("Invalid suggestion request.", "VALIDATION_ERROR", 400);
  }
  const session = await loadSession(sessionId, tenantId);
  const target = parsed.data.placements.find((p) => p.id === parsed.data.targetPlacementId);
  if (!target) throw new PlacementEngineError("Target placement is not in this session.", "PLACEMENT_NOT_FOUND", 404);
  if (target.isArchived) throw new PlacementEngineError("Archived placements cannot be suggested.", "PLACEMENT_ARCHIVED", 409);

  const roomWidth = Number(session.widthCm);
  const roomDepth = Number(session.depthCm);
  const candidates = STRATEGIES.map((strategy, index) => {
    const moved = placementForStrategy(target, strategy, roomWidth, roomDepth);
    const geometry = parsed.data.placements.map((p) => p.id === target.id ? moved : p);
    const result = checkGeometryCollision(geometry, { widthCm: roomWidth, depthCm: roomDepth });
    const rules = ruleMessages(result);
    const warnings = [...rules.hard, ...rules.soft];
    const valid = rules.hard.length === 0;
    const payload = candidatePayload(sessionId, target, strategy);
    const candidate: Wp06aCandidate = {
      candidateId: encodeCandidate(payload),
      strategy,
      rank: index + 1,
      score: scoreCandidate(moved, strategy, roomWidth, roomDepth),
      valid,
      targetPlacementId: target.id,
      placement: moved,
      warnings,
      explanation: valid
        ? `${strategy.replaceAll("_", " ").toLowerCase()} keeps the item inside the room without hard-rule violations.`
        : `${strategy.replaceAll("_", " ").toLowerCase()} needs review because it violates one or more hard rules.`,
    };
    return candidate;
  });

  candidates.sort((a, b) => Number(b.valid) - Number(a.valid) || b.score - a.score || a.strategy.localeCompare(b.strategy));
  return { sessionId, candidates: candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 })) };
}

export async function applyPlacement(
  sessionId: string,
  tenantId: string,
  input: unknown,
): Promise<PlacementRow> {
  const parsed = wp06aApplySchema.safeParse(input);
  if (!parsed.success) throw new PlacementEngineError("candidateId is required.", "VALIDATION_ERROR", 400);
  const payload = decodeCandidate(parsed.data.candidateId);
  if (payload["version"] !== 1 || payload["sessionId"] !== sessionId || typeof payload["targetPlacementId"] !== "string") {
    throw new PlacementEngineError("Candidate does not belong to this session.", "INVALID_CANDIDATE", 422);
  }
  const strategy = payload["strategy"];
  if (!STRATEGIES.includes(strategy as Strategy)) throw new PlacementEngineError("Invalid candidate strategy.", "INVALID_CANDIDATE", 422);

  const session = await loadSession(sessionId, tenantId);
  const targetId = payload["targetPlacementId"];

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(placementsTable)
      .where(and(eq(placementsTable.id, targetId), eq(placementsTable.sessionId, sessionId), eq(placementsTable.tenantId, tenantId)))
      .limit(1);
    if (!current) throw new PlacementEngineError("Placement not found.", "PLACEMENT_NOT_FOUND", 404);
    if (current.isArchived) throw new PlacementEngineError("Archived placements cannot be applied.", "PLACEMENT_ARCHIVED", 409);
    const expectedVersion = Number(payload["baseVersion"]);
    const base = payload["base"];
    if (!base || typeof base !== "object" || current.version !== expectedVersion ||
        Number(current.xCm) !== Number((base as Record<string, unknown>)["xCm"]) ||
        Number(current.yCm) !== Number((base as Record<string, unknown>)["yCm"])) {
      throw new PlacementEngineError("The preview is stale. Refresh and suggest again.", "STALE_CANDIDATE", 409);
    }

    const all = await tx
      .select()
      .from(placementsTable)
      .where(and(eq(placementsTable.sessionId, sessionId), eq(placementsTable.tenantId, tenantId)));
    const target = parsePlacement(current);
    const moved = placementForStrategy(target, strategy as Strategy, Number(session.widthCm), Number(session.depthCm));
    const geometry = all.map((p) => p.id === current.id ? moved : parsePlacement(p));
    const validation = checkGeometryCollision(geometry, { widthCm: Number(session.widthCm), depthCm: Number(session.depthCm) });
    const rules = ruleMessages(validation);
    if (rules.hard.length > 0) {
      throw new PlacementEngineError("Candidate violates placement rules.", "HARD_RULE_VIOLATION", 422);
    }

    const [updated] = await tx
      .update(placementsTable)
      .set({
        xCm: String(moved.xCm),
        yCm: String(moved.yCm),
        rotationDeg: String(moved.rotationDeg ?? 0),
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(placementsTable.id, current.id), eq(placementsTable.version, current.version)))
      .returning();
    if (!updated) throw new PlacementEngineError("Placement changed while applying.", "CONCURRENT_APPLY", 409);
    return updated;
  });
}