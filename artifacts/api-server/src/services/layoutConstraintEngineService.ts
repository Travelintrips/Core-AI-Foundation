/**
 * WP-07 — deterministic complete-layout constraint engine.
 *
 * This module evaluates a complete server-owned layout. It deliberately
 * delegates all rotated geometry to the WP-03B/WP-04A collision primitives.
 * It never persists or mutates a session.
 */
import { db, layoutSessionsTable, placementsTable } from "@workspace/db";
import {
  MAX_PLACEMENTS_PER_COLLISION_SESSION,
  wp07ConstraintResultSchema,
  wp07PlacementMetadataSchema,
  wp07SessionMetadataSchema,
  type Wp07ConstraintResult,
  type Wp07PlacementMetadata,
  type Wp07SessionMetadata,
} from "@workspace/api-zod";
import { and, eq, isNull } from "drizzle-orm";
import { checkGeometryCollision } from "./collisionEngineService.js";
import { checkPair } from "./collision-engine/collisionEngine.js";
import { PlacementEngineError } from "./placementEngineService.js";
import type { PlacementGeometry, RoomBounds } from "./collision-engine/types.js";

type RuleId =
  | "HC-01" | "HC-02" | "HC-03" | "HC-04" | "HC-05" | "HC-06" | "HC-07" | "HC-08" | "HC-09" | "HC-10" | "HC-11"
  | "SC-01" | "SC-02" | "SC-03" | "SC-04" | "SC-05" | "SC-06" | "SC-07" | "SC-08" | "SC-09";
type RuleCategory = "hard" | "soft";
type RuleStatus = "pass" | "fail" | "warning" | "not_applicable";

export interface LayoutConstraintPlacement extends PlacementGeometry {
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface LayoutConstraintSession {
  sessionId: string;
  room: RoomBounds;
  placements: LayoutConstraintPlacement[];
  metadata?: Record<string, unknown>;
}

interface RuleResult {
  ruleId: RuleId;
  category: RuleCategory;
  status: RuleStatus;
  score: number | null;
  message: string;
  itemIds: string[];
}

interface Violation {
  ruleId: RuleId;
  itemIds: string[];
  message: string;
}

interface Warning {
  ruleId: RuleId;
  itemIds: string[];
  message: string;
}

interface Remediation {
  ruleId: RuleId;
  action:
    | "move_item_inside_room"
    | "increase_clearance"
    | "move_item_away_from_door"
    | "move_item_away_from_window"
    | "resolve_overlap"
    | "clear_excluded_zone"
    | "improve_wall_alignment"
    | "improve_circulation"
    | "move_toward_preferred_zone"
    | "review_geometry";
  message: string;
  itemIds: string[];
}

const HARD_RULES: readonly RuleId[] = [
  "HC-01", "HC-02", "HC-03", "HC-04", "HC-05", "HC-06", "HC-07", "HC-08", "HC-09", "HC-10", "HC-11",
];
const SOFT_RULES: readonly RuleId[] = [
  "SC-01", "SC-02", "SC-03", "SC-04", "SC-05", "SC-06", "SC-07", "SC-08", "SC-09",
];
const SOFT_WEIGHTS: Record<Extract<RuleId, `SC-${string}`>, number> = {
  "SC-01": 10, "SC-02": 15, "SC-03": 10, "SC-04": 15, "SC-05": 10,
  "SC-06": 15, "SC-07": 10, "SC-08": 5, "SC-09": 10,
};

function metadata<T>(schema: { safeParse(value: unknown): { success: boolean; data?: T } }, raw: unknown): T {
  const result = schema.safeParse(raw ?? {});
  return result.success && result.data ? result.data : {} as T;
}

function placementMetadata(item: LayoutConstraintPlacement): Wp07PlacementMetadata {
  return metadata(wp07PlacementMetadataSchema, item.metadata);
}

function sessionMetadata(session: LayoutConstraintSession): Wp07SessionMetadata {
  return metadata(wp07SessionMetadataSchema, session.metadata);
}

function activeItems(items: LayoutConstraintPlacement[]): LayoutConstraintPlacement[] {
  return [...items].filter((item) => !item.isArchived).sort((a, b) => a.id.localeCompare(b.id));
}

function finiteGeometry(item: LayoutConstraintPlacement): boolean {
  return [
    item.xCm, item.yCm, item.widthCm, item.depthCm, item.rotationDeg,
    item.anchorX, item.anchorY, item.clearanceFrontCm, item.clearanceSideCm, item.clearanceBackCm,
  ].every(Number.isFinite) && item.widthCm > 0 && item.depthCm > 0;
}

function zoneGeometry(zone: NonNullable<Wp07SessionMetadata["doors"]>[number], prefix: string, clearance = 0): PlacementGeometry {
  return {
    id: `${prefix}:${zone.id}`,
    xCm: zone.xCm - clearance,
    yCm: zone.yCm - clearance,
    widthCm: zone.widthCm + clearance * 2,
    depthCm: zone.depthCm + clearance * 2,
    rotationDeg: zone.rotationDeg ?? 0,
    anchorX: 0,
    anchorY: 0,
    clearanceFrontCm: 0,
    clearanceSideCm: 0,
    clearanceBackCm: 0,
    isArchived: false,
  };
}

function makeRule(
  ruleId: RuleId,
  category: RuleCategory,
  status: RuleStatus,
  message: string,
  itemIds: string[] = [],
  score: number | null = category === "hard" ? null : status === "not_applicable" ? null : 100,
): RuleResult {
  return { ruleId, category, status, score, message, itemIds: [...itemIds].sort() };
}

function nearestWallDistance(item: LayoutConstraintPlacement, room: RoomBounds): number {
  return Math.min(item.xCm, item.yCm, room.widthCm - item.xCm - item.widthCm, room.depthCm - item.yCm - item.depthCm);
}

function overlapWithZones(items: LayoutConstraintPlacement[], zones: Wp07SessionMetadata["excludedZones"], prefix: string): string[] {
  if (!zones?.length) return [];
  const hits: string[] = [];
  for (const item of items) {
    for (const zone of zones) {
      const result = checkPair(item, zoneGeometry(zone, prefix, zone.clearanceCm ?? 0));
      if (result.overlaps) {
        hits.push(item.id);
        break;
      }
    }
  }
  return hits.sort();
}

function scoreFromAverage(values: number[]): number {
  if (values.length === 0) return 100;
  const score = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(Math.max(0, Math.min(100, score)).toFixed(4));
}

function evaluateSoftRule(
  ruleId: (typeof SOFT_RULES)[number],
  items: LayoutConstraintPlacement[],
  room: RoomBounds,
  sessionMeta: Wp07SessionMetadata,
): RuleResult {
  const itemIds = items.map((item) => item.id);
  const placementMeta = new Map(items.map((item) => [item.id, placementMetadata(item)]));

  if (ruleId === "SC-01") {
    const scores = items.map((item) => Math.max(0, Math.min(100, 100 - Math.max(0, nearestWallDistance(item, room)) / 2)));
    return makeRule(ruleId, "soft", "pass", "Wall alignment is derived from each item’s nearest room wall.", itemIds, scoreFromAverage(scores));
  }
  if (ruleId === "SC-02") {
    if (!sessionMeta.walkwayZones?.length && sessionMeta.minWalkwayClearanceCm == null) {
      return makeRule(ruleId, "soft", "not_applicable", "No canonical walkway zones or minimum walkway clearance is configured.");
    }
    const hits = overlapWithZones(items, sessionMeta.walkwayZones, "walkway");
    const score = hits.length === 0 ? 100 : Math.max(0, 100 - hits.length / Math.max(1, items.length) * 100);
    return makeRule(ruleId, "soft", hits.length ? "warning" : "pass", hits.length ? "Some items reduce the configured circulation area." : "Configured circulation areas remain clear.", hits, score);
  }
  if (ruleId === "SC-03") {
    if (!sessionMeta.symmetryAxis) return makeRule(ruleId, "soft", "not_applicable", "No canonical symmetry axis is configured.");
    const axis = sessionMeta.symmetryAxis === "vertical" ? room.widthCm / 2 : room.depthCm / 2;
    const centers = items.map((item) => sessionMeta.symmetryAxis === "vertical" ? item.xCm + item.widthCm / 2 : item.yCm + item.depthCm / 2);
    const averageDistance = centers.length ? centers.reduce((sum, value) => sum + Math.abs(value - axis), 0) / centers.length : 0;
    return makeRule(ruleId, "soft", "pass", "Placement distribution was compared with the configured symmetry axis.", itemIds, Number(Math.max(0, 100 - averageDistance / Math.max(1, axis) * 100).toFixed(4)));
  }
  if (ruleId === "SC-04") {
    const zones = [...(sessionMeta.preferredZones ?? []), ...(sessionMeta.walkwayZones ?? [])];
    if (!zones.length || items.some((item) => !placementMeta.get(item.id)?.zoneId)) {
      return makeRule(ruleId, "soft", "not_applicable", "Canonical zoning metadata is incomplete.");
    }
    const zoneIds = new Set(zones.map((zone) => zone.id));
    const assigned = items.filter((item) => zoneIds.has(placementMeta.get(item.id)?.zoneId ?? "")).length;
    return makeRule(ruleId, "soft", "pass", "Placement zone assignments match canonical room zones.", itemIds, Number((assigned / Math.max(1, items.length) * 100).toFixed(4)));
  }
  if (ruleId === "SC-05") {
    if (!sessionMeta.focalPoint) return makeRule(ruleId, "soft", "not_applicable", "No canonical focal point is configured.");
    const distances = items.map((item) => {
      const x = item.xCm + item.widthCm / 2;
      const y = item.yCm + item.depthCm / 2;
      return Math.hypot(x - sessionMeta.focalPoint!.xCm, y - sessionMeta.focalPoint!.yCm);
    });
    const maxDistance = Math.hypot(room.widthCm, room.depthCm);
    return makeRule(ruleId, "soft", "pass", "Furniture orientation is evaluated against the configured focal point.", itemIds, scoreFromAverage(distances.map((distance) => 100 - distance / maxDistance * 100)));
  }
  if (ruleId === "SC-06") {
    if (items.length < 2) return makeRule(ruleId, "soft", "not_applicable", "Spacing balance needs at least two active items.");
    const distances: number[] = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i]!;
        const b = items[j]!;
        distances.push(Math.hypot((a.xCm + a.widthCm / 2) - (b.xCm + b.widthCm / 2), (a.yCm + a.depthCm / 2) - (b.yCm + b.depthCm / 2)));
      }
    }
    const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length;
    return makeRule(ruleId, "soft", "pass", "Pairwise center spacing is balanced across the active layout.", itemIds, Number(Math.max(0, 100 - Math.sqrt(variance) / Math.max(1, mean) * 100).toFixed(4)));
  }
  if (ruleId === "SC-07") {
    if (!sessionMeta.roomFunction || items.some((item) => !placementMeta.get(item.id)?.roomFunction && !placementMeta.get(item.id)?.compatibleRoomFunctions)) {
      return makeRule(ruleId, "soft", "not_applicable", "Canonical room-function metadata is incomplete.");
    }
    const matching = items.filter((item) => {
      const meta = placementMeta.get(item.id)!;
      return meta.roomFunction === sessionMeta.roomFunction || meta.compatibleRoomFunctions?.includes(sessionMeta.roomFunction!);
    }).length;
    return makeRule(ruleId, "soft", "pass", "Placement metadata is compatible with the room function.", itemIds, Number((matching / Math.max(1, items.length) * 100).toFixed(4)));
  }
  if (ruleId === "SC-08") {
    const sessionStyles = new Set([sessionMeta.style, ...(sessionMeta.styleTags ?? [])].filter(Boolean).map((value) => value!.toLowerCase()));
    if (sessionStyles.size === 0 || items.some((item) => !(placementMeta.get(item.id)?.style || placementMeta.get(item.id)?.styleTags?.length))) {
      return makeRule(ruleId, "soft", "not_applicable", "Canonical style metadata is incomplete.");
    }
    const matching = items.filter((item) => {
      const meta = placementMeta.get(item.id)!;
      const itemStyles = new Set([meta.style, ...(meta.styleTags ?? [])].filter(Boolean).map((value) => value!.toLowerCase()));
      return [...itemStyles].some((style) => sessionStyles.has(style));
    }).length;
    return makeRule(ruleId, "soft", "pass", "Placement styles are compared with the session style metadata.", itemIds, Number((matching / Math.max(1, items.length) * 100).toFixed(4)));
  }
  if (!sessionMeta.preferredZones?.length) {
    return makeRule(ruleId, "soft", "not_applicable", "No canonical preferred zones are configured.");
  }
  const preferredHits = overlapWithZones(items, sessionMeta.preferredZones, "preferred");
  const score = Number((preferredHits.length / Math.max(1, items.length) * 100).toFixed(4));
  return makeRule(ruleId, "soft", "pass", "Placement adherence to preferred zones was evaluated.", itemIds, score);
}

export function evaluateLayoutConstraints(input: LayoutConstraintSession): Wp07ConstraintResult {
  const startedAt = Date.now();
  const items = activeItems(input.placements);
  const room = { widthCm: Number(input.room.widthCm), depthCm: Number(input.room.depthCm) };
  const sessionMeta = sessionMetadata(input);
  const hardViolations: Violation[] = [];
  const softWarnings: Warning[] = [];
  const remediations: Remediation[] = [];
  const rules = new Map<RuleId, RuleResult>();
  const validItems = items.filter(finiteGeometry);
  const invalidItems = items.filter((item) => !finiteGeometry(item));

  if (invalidItems.length) {
    const itemIds = invalidItems.map((item) => item.id).sort();
    const message = "One or more placements contain malformed, non-finite, or non-positive geometry.";
    hardViolations.push({ ruleId: "HC-09", itemIds, message });
    remediations.push({ ruleId: "HC-09", action: "review_geometry", itemIds, message: "Review dimensions, coordinates, and rotation values before evaluating again." });
    rules.set("HC-09", makeRule("HC-09", "hard", "fail", message, itemIds));
  } else {
    rules.set("HC-09", makeRule("HC-09", "hard", "pass", "All active placement geometry values are finite and positive.", []));
  }

  const collisionResult = validItems.length
    ? checkGeometryCollision(validItems, room)
    : { physicalCollisions: [], clearanceWarnings: [], roomViolations: [], checkedPairs: 0, checkedPlacements: 0 };
  const boundsIds = collisionResult.roomViolations.map((violation) => violation.placementId).sort();
  if (boundsIds.length) {
    const message = "One or more furniture footprints extend outside the room boundary.";
    hardViolations.push({ ruleId: "HC-01", itemIds: boundsIds, message });
    remediations.push({ ruleId: "HC-01", action: "move_item_inside_room", itemIds: boundsIds, message: "Move each item fully inside the room, including its rotated corners." });
  }
  rules.set("HC-01", makeRule("HC-01", "hard", boundsIds.length ? "fail" : "pass", boundsIds.length ? "Room bounds are violated." : "All active furniture footprints remain inside the room.", boundsIds));

  const collisionIds = [...new Set(collisionResult.physicalCollisions.flatMap((collision) => [collision.idA, collision.idB]))].sort();
  if (collisionIds.length) {
    const message = "Furniture footprints overlap another active placement.";
    hardViolations.push({ ruleId: "HC-02", itemIds: collisionIds, message });
    remediations.push({ ruleId: "HC-02", action: "resolve_overlap", itemIds: collisionIds, message: "Move or rotate the affected items until the overlap is resolved." });
  }
  rules.set("HC-02", makeRule("HC-02", "hard", collisionIds.length ? "fail" : "pass", collisionIds.length ? "Furniture collision detected." : "No active furniture footprints overlap.", collisionIds));

  const lockedIds = items.filter((item) => placementMetadata(item).locked === true).map((item) => item.id).sort();
  rules.set("HC-03", makeRule("HC-03", "hard", "pass", lockedIds.length ? "Locked items were evaluated read-only." : "No locked items require protection.", lockedIds));

  const doors = sessionMeta.doors ?? [];
  const doorHits = doors.length ? overlapWithZones(validItems, doors, "door") : [];
  if (doorHits.length) {
    const message = "Furniture violates the clearance envelope of a canonical door.";
    hardViolations.push({ ruleId: "HC-04", itemIds: doorHits, message });
    remediations.push({ ruleId: "HC-04", action: "move_item_away_from_door", itemIds: doorHits, message: "Move affected items away from the door clearance envelope." });
  }
  rules.set("HC-04", makeRule("HC-04", "hard", doors.length ? (doorHits.length ? "fail" : "pass") : "not_applicable", doors.length ? (doorHits.length ? "Door clearance is violated." : "Canonical door clearance is respected.") : "No canonical door metadata is available.", doorHits));

  const windows = sessionMeta.windows ?? [];
  const windowHits = windows.length ? overlapWithZones(validItems, windows, "window") : [];
  if (windowHits.length) {
    const message = "Furniture violates the clearance envelope of a canonical window.";
    hardViolations.push({ ruleId: "HC-05", itemIds: windowHits, message });
    remediations.push({ ruleId: "HC-05", action: "move_item_away_from_window", itemIds: windowHits, message: "Move affected items away from the window clearance envelope." });
  }
  rules.set("HC-05", makeRule("HC-05", "hard", windows.length ? (windowHits.length ? "fail" : "pass") : "not_applicable", windows.length ? (windowHits.length ? "Window clearance is violated." : "Canonical window clearance is respected.") : "No canonical window metadata is available.", windowHits));

  const walkwayHits = sessionMeta.walkwayZones?.length ? overlapWithZones(validItems, sessionMeta.walkwayZones, "walkway") : [];
  if (walkwayHits.length) {
    const message = "Furniture occupies a configured walkway zone.";
    hardViolations.push({ ruleId: "HC-06", itemIds: walkwayHits, message });
    remediations.push({ ruleId: "HC-06", action: "improve_circulation", itemIds: walkwayHits, message: "Clear the configured walkway area to restore circulation." });
  }
  rules.set("HC-06", makeRule("HC-06", "hard", sessionMeta.walkwayZones?.length ? (walkwayHits.length ? "fail" : "pass") : "not_applicable", sessionMeta.walkwayZones?.length ? (walkwayHits.length ? "Walkway clearance is violated." : "Configured walkway zones remain clear.") : "No canonical walkway zones are available.", walkwayHits));

  const clearanceThreshold = sessionMeta.minFurnitureClearanceCm ?? 0;
  const clearanceHits = clearanceThreshold > 0
    ? collisionResult.clearanceWarnings.filter((warning) => warning.overlapDepth > clearanceThreshold).map((warning) => warning.placementId)
    : [];
  const uniqueClearanceHits = [...new Set(clearanceHits)].sort();
  if (uniqueClearanceHits.length) {
    const message = "Configured minimum furniture spacing is not respected.";
    hardViolations.push({ ruleId: "HC-07", itemIds: uniqueClearanceHits, message });
    remediations.push({ ruleId: "HC-07", action: "increase_clearance", itemIds: uniqueClearanceHits, message: "Increase the spacing around affected furniture items." });
  }
  rules.set("HC-07", makeRule("HC-07", "hard", clearanceThreshold > 0 ? (uniqueClearanceHits.length ? "fail" : "pass") : "not_applicable", clearanceThreshold > 0 ? (uniqueClearanceHits.length ? "Furniture spacing is below the configured minimum." : "Configured furniture spacing is respected.") : "No minimum furniture clearance is configured.", uniqueClearanceHits));

  const excludedHits = overlapWithZones(validItems, sessionMeta.excludedZones, "excluded");
  if (excludedHits.length) {
    const message = "Furniture violates a canonical excluded zone.";
    hardViolations.push({ ruleId: "HC-08", itemIds: excludedHits, message });
    remediations.push({ ruleId: "HC-08", action: "clear_excluded_zone", itemIds: excludedHits, message: "Move affected items outside the excluded zone." });
  }
  rules.set("HC-08", makeRule("HC-08", "hard", sessionMeta.excludedZones?.length ? (excludedHits.length ? "fail" : "pass") : "not_applicable", sessionMeta.excludedZones?.length ? (excludedHits.length ? "Excluded zones are violated." : "Excluded zones remain clear.") : "No canonical excluded zones are available.", excludedHits));

  const maxPlacements = sessionMeta.maxPlacements ?? MAX_PLACEMENTS_PER_COLLISION_SESSION;
  if (items.length > maxPlacements) {
    const message = `The session contains ${items.length} active items, above the configured limit of ${maxPlacements}.`;
    hardViolations.push({ ruleId: "HC-10", itemIds: [], message });
  }
  rules.set("HC-10", makeRule("HC-10", "hard", items.length > maxPlacements ? "fail" : "pass", items.length > maxPlacements ? "Session capacity is exceeded." : "Session item count is within the configured capacity.", []));
  rules.set("HC-11", makeRule("HC-11", "hard", "pass", input.metadata && (input.metadata["approvedForRendering"] === true || input.metadata["reviewState"] === "approved_for_rendering") ? "Approved layout was evaluated without mutation." : "Evaluation is read-only and does not mutate the layout.", []));

  for (const ruleId of SOFT_RULES) {
    // Invalid geometry is already reported by HC-09. Excluding it from soft
    // metrics keeps every diagnostic score finite while preserving the
    // invalid item's ID in the hard-constraint result.
    const result = evaluateSoftRule(ruleId, validItems, room, sessionMeta);
    rules.set(ruleId, result);
    if (result.status === "warning") {
      softWarnings.push({ ruleId, itemIds: result.itemIds, message: result.message });
      remediations.push({ ruleId, action: ruleId === "SC-01" ? "improve_wall_alignment" : ruleId === "SC-02" ? "improve_circulation" : "move_toward_preferred_zone", itemIds: result.itemIds, message: result.message });
    }
  }

  const ruleResults = [...HARD_RULES, ...SOFT_RULES].map((ruleId) => rules.get(ruleId)!);
  const scoreBreakdown = SOFT_RULES.map((ruleId) => {
    const result = rules.get(ruleId)!;
    const weight = SOFT_WEIGHTS[ruleId as keyof typeof SOFT_WEIGHTS];
    const score = result.score;
    return {
      ruleId,
      weight,
      score,
      weightedScore: score == null ? 0 : Number((score * weight / 100).toFixed(4)),
      status: result.status === "warning" ? "warning" : result.status === "not_applicable" ? "not_applicable" : "pass",
    } as const;
  });
  const applicableWeight = scoreBreakdown.filter((item) => item.score != null).reduce((sum, item) => sum + item.weight, 0);
  const totalScore = Number(Math.max(0, Math.min(100, applicableWeight === 0 ? 100 : scoreBreakdown.reduce((sum, item) => sum + item.weightedScore, 0) / applicableWeight * 100)).toFixed(4));
  const hardRuleCount = HARD_RULES.length;
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const result = {
    valid: hardViolations.length === 0,
    totalScore,
    hardViolations: hardViolations.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.itemIds.join(",").localeCompare(b.itemIds.join(","))),
    softWarnings: softWarnings.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.itemIds.join(",").localeCompare(b.itemIds.join(","))),
    ruleResults,
    scoreBreakdown,
    explanation: hardViolations.length === 0
      ? `Layout passed all applicable hard constraints with a deterministic score of ${totalScore}.`
      : `Layout is invalid because ${hardViolations.length} hard constraint violation(s) require attention. The diagnostic score is ${totalScore}.`,
    suggestedRemediations: remediations.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.itemIds.join(",").localeCompare(b.itemIds.join(","))),
    deterministic: true as const,
    metadata: {
      sessionId: input.sessionId,
      itemsEvaluated: items.length,
      rulesEvaluated: hardRuleCount + SOFT_RULES.length,
      pairChecks: collisionResult.checkedPairs,
      hardViolationCount: hardViolations.length,
      softWarningCount: softWarnings.length,
      elapsedMs,
      approvedLayout: input.metadata?.["approvedForRendering"] === true || input.metadata?.["reviewState"] === "approved_for_rendering",
    },
  };
  return wp07ConstraintResultSchema.parse(result);
}

export async function evaluateLayoutSessionConstraints(sessionId: string, tenantId: string): Promise<Wp07ConstraintResult> {
  const [session] = await db.select().from(layoutSessionsTable).where(and(
    eq(layoutSessionsTable.id, sessionId),
    eq(layoutSessionsTable.tenantId, tenantId),
    isNull(layoutSessionsTable.deletedAt),
  )).limit(1);
  if (!session) throw new PlacementEngineError("Layout session not found.", "SESSION_NOT_FOUND", 404);

  const rows = await db.select().from(placementsTable).where(and(
    eq(placementsTable.sessionId, sessionId),
    eq(placementsTable.tenantId, tenantId),
  )).orderBy(placementsTable.id);
  const activeCount = rows.filter((row) => !row.isArchived).length;
  if (activeCount > MAX_PLACEMENTS_PER_COLLISION_SESSION) {
    throw new PlacementEngineError("Layout session exceeds the maximum supported item count.", "PLACEMENT_LIMIT_EXCEEDED", 422);
  }

  return evaluateLayoutConstraints({
    sessionId,
    room: { widthCm: Number(session.widthCm), depthCm: Number(session.depthCm) },
    metadata: session.metadata,
    placements: rows.map((row) => ({
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
      metadata: row.metadata,
    })),
  });
}