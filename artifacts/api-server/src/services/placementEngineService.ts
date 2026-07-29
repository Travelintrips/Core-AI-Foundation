/**
 * WP-03A — Placement Engine Service (v2 rebuild)
 *
 * Provides:
 *   - Session CRUD (create, get, list, update, archive, restore)
 *   - Placement CRUD (create, get, list, move, rotate, duplicate, archive, restore)
 *   - Pure helpers (normalizeRotation, validateCoordinates, validateDimensions,
 *                   getBoundingRect, toLocalCoords, toWorldCoords,
 *                   serializeSession, serializePlacement,
 *                   snapToGrid, snapToWall, snapToCorner, snapToItemAnchor)
 *   - Tenant consistency assertion
 *
 * No collision detection, undo/redo, constraint engine, or AI layout in scope.
 * Service validates early; database trigger enforces final invariant.
 */

import { eq, and, isNull, desc, sql, ilike } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  layoutSessionsTable,
  placementsTable,
  type LayoutSession,
  type InsertLayoutSession,
  type Placement,
} from "@workspace/db";

// ── Error class ────────────────────────────────────────────────────────────────

export class PlacementEngineError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "TENANT_MISMATCH"
      | "SESSION_NOT_FOUND"
      | "INVALID_INPUT"
      | "FORBIDDEN"
      | "CONFLICT"
      | "SESSION_ARCHIVED",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "PlacementEngineError";
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Normalize rotation to [0, 360). Returns 0 for non-finite input.
 */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const mod = deg % 360;
  return mod < 0 ? mod + 360 : mod;
}

/** Throws INVALID_INPUT if coordinates are not finite numbers. */
export function validateCoordinates(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new PlacementEngineError(
      "Coordinates must be finite numbers",
      "INVALID_INPUT",
      400,
    );
  }
}

/** Throws INVALID_INPUT if any dimension is not finite or is <= 0. */
export function validateDimensions(
  widthCm: number,
  depthCm: number,
  heightCm: number,
): void {
  if (
    !Number.isFinite(widthCm) ||
    !Number.isFinite(depthCm) ||
    !Number.isFinite(heightCm)
  ) {
    throw new PlacementEngineError(
      "Dimensions must be finite numbers",
      "INVALID_INPUT",
      400,
    );
  }
  if (widthCm <= 0 || depthCm <= 0 || heightCm <= 0) {
    throw new PlacementEngineError(
      "All dimensions must be greater than 0",
      "INVALID_INPUT",
      400,
    );
  }
}

export interface BoundingRect {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  widthCm: number;
  depthCm: number;
}

/** Axis-aligned bounding rectangle for a placed item. */
export function getBoundingRect(
  xCm: number,
  yCm: number,
  widthCm: number,
  depthCm: number,
): BoundingRect {
  return {
    xMin: xCm,
    yMin: yCm,
    xMax: xCm + widthCm,
    yMax: yCm + depthCm,
    widthCm,
    depthCm,
  };
}

/** Convert world coordinates to item-local coordinates. */
export function toLocalCoords(
  worldX: number,
  worldY: number,
  itemX: number,
  itemY: number,
): { x: number; y: number } {
  return { x: worldX - itemX, y: worldY - itemY };
}

/** Convert item-local coordinates to world coordinates. */
export function toWorldCoords(
  localX: number,
  localY: number,
  itemX: number,
  itemY: number,
): { x: number; y: number } {
  return { x: localX + itemX, y: localY + itemY };
}

/** Serialize a LayoutSession to a plain object. */
export function serializeSession(session: LayoutSession): Record<string, unknown> {
  return {
    id: session.id,
    tenantId: session.tenantId ?? null,
    roomTemplateId: session.roomTemplateId ?? null,
    name: session.name,
    status: session.status,
    coordinateUnit: session.coordinateUnit,
    roomWidthCm: Number(session.roomWidthCm),
    roomLengthCm: Number(session.roomLengthCm),
    metadata: session.metadata,
    createdBy: session.createdBy,
    createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
    updatedAt: session.updatedAt instanceof Date ? session.updatedAt.toISOString() : session.updatedAt,
    archivedAt: session.archivedAt instanceof Date ? session.archivedAt.toISOString() : (session.archivedAt ?? null),
  };
}

/** Serialize a Placement to a plain object. */
export function serializePlacement(
  placement: Placement,
): Record<string, unknown> {
  return {
    id: placement.id,
    tenantId: placement.tenantId ?? null,
    sessionId: placement.sessionId,
    furnitureItemId: placement.furnitureItemId,
    xCm: Number(placement.xCm),
    yCm: Number(placement.yCm),
    widthCm: Number(placement.widthCm),
    depthCm: Number(placement.depthCm),
    heightCm: Number(placement.heightCm),
    rotationDeg: Number(placement.rotationDeg),
    anchorType: placement.anchorType,
    anchorData: placement.anchorData,
    snapType: placement.snapType,
    snapData: placement.snapData,
    metadata: placement.metadata,
    version: placement.version,
    createdBy: placement.createdBy,
    createdAt: placement.createdAt instanceof Date ? placement.createdAt.toISOString() : placement.createdAt,
    updatedAt: placement.updatedAt instanceof Date ? placement.updatedAt.toISOString() : placement.updatedAt,
    archivedAt: placement.archivedAt instanceof Date ? placement.archivedAt.toISOString() : (placement.archivedAt ?? null),
  };
}

/** Deserialize a plain object into a LayoutSession shape (validation only). */
export function deserializeSession(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== "object") {
    throw new PlacementEngineError("Invalid session object", "INVALID_INPUT", 400);
  }
  const o = obj as Record<string, unknown>;
  if (!o["id"] || !o["name"]) {
    throw new PlacementEngineError("Session missing required fields: id, name", "INVALID_INPUT", 400);
  }
  return o;
}

/** Deserialize a plain object into a Placement shape (validation only). */
export function deserializePlacement(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== "object") {
    throw new PlacementEngineError("Invalid placement object", "INVALID_INPUT", 400);
  }
  const o = obj as Record<string, unknown>;
  if (!o["id"] || !o["sessionId"] || !o["furnitureItemId"]) {
    throw new PlacementEngineError(
      "Placement missing required fields: id, sessionId, furnitureItemId",
      "INVALID_INPUT",
      400,
    );
  }
  return o;
}

// ── Snapping ───────────────────────────────────────────────────────────────────

export interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  snapType: string;
}

export interface GridSnapOptions {
  gridSizeCm: number;
}

/**
 * Snap to grid. Returns unchanged position if gridSizeCm <= 0.
 */
export function snapToGrid(
  x: number,
  y: number,
  options: GridSnapOptions,
): SnapResult {
  const { gridSizeCm } = options;
  if (!gridSizeCm || gridSizeCm <= 0) {
    return { x, y, snapped: false, snapType: "none" };
  }
  const snappedX = Math.round(x / gridSizeCm) * gridSizeCm;
  const snappedY = Math.round(y / gridSizeCm) * gridSizeCm;
  const snapped = snappedX !== x || snappedY !== y;
  return { x: snappedX, y: snappedY, snapped, snapType: snapped ? "grid" : "none" };
}

export interface WallSnapOptions {
  roomWidthCm: number;
  roomLengthCm: number;
  itemWidthCm: number;
  itemDepthCm: number;
  snapDistanceCm?: number;
}

/**
 * Snap to nearest room wall if within snapDistanceCm (default 10).
 */
export function snapToWall(
  x: number,
  y: number,
  options: WallSnapOptions,
): SnapResult {
  const {
    roomWidthCm,
    roomLengthCm,
    itemWidthCm,
    itemDepthCm,
    snapDistanceCm = 10,
  } = options;
  let nx = x;
  let ny = y;
  let snapped = false;

  // Left wall
  if (x <= snapDistanceCm) { nx = 0; snapped = true; }
  // Right wall
  else if (x + itemWidthCm >= roomWidthCm - snapDistanceCm) {
    nx = roomWidthCm - itemWidthCm; snapped = true;
  }

  // Bottom wall
  if (y <= snapDistanceCm) { ny = 0; snapped = true; }
  // Top wall
  else if (y + itemDepthCm >= roomLengthCm - snapDistanceCm) {
    ny = roomLengthCm - itemDepthCm; snapped = true;
  }

  return { x: nx, y: ny, snapped, snapType: snapped ? "wall" : "none" };
}

export interface CornerSnapOptions {
  roomWidthCm: number;
  roomLengthCm: number;
  itemWidthCm: number;
  itemDepthCm: number;
  snapDistanceCm?: number;
}

/**
 * Snap to nearest room corner if within snapDistanceCm (default 15).
 */
export function snapToCorner(
  x: number,
  y: number,
  options: CornerSnapOptions,
): SnapResult {
  const {
    roomWidthCm,
    roomLengthCm,
    itemWidthCm,
    itemDepthCm,
    snapDistanceCm = 15,
  } = options;

  const corners = [
    { cx: 0, cy: 0 },
    { cx: roomWidthCm - itemWidthCm, cy: 0 },
    { cx: 0, cy: roomLengthCm - itemDepthCm },
    { cx: roomWidthCm - itemWidthCm, cy: roomLengthCm - itemDepthCm },
  ];

  let nearest = { x, y, dist: Infinity };
  for (const corner of corners) {
    const dist = Math.sqrt((x - corner.cx) ** 2 + (y - corner.cy) ** 2);
    if (dist < nearest.dist) {
      nearest = { x: corner.cx, y: corner.cy, dist };
    }
  }

  if (nearest.dist <= snapDistanceCm) {
    return { x: nearest.x, y: nearest.y, snapped: true, snapType: "corner" };
  }
  return { x, y, snapped: false, snapType: "none" };
}

export interface ItemAnchorSnapOptions {
  anchorItemBounds: BoundingRect;
  snapDistanceCm?: number;
}

/**
 * Snap to a reference item's anchor points (edges and center).
 * Only applies when snapType === 'item_anchor' is explicitly requested.
 */
export function snapToItemAnchor(
  x: number,
  y: number,
  options: ItemAnchorSnapOptions,
): SnapResult {
  const { anchorItemBounds, snapDistanceCm = 5 } = options;
  const { xMin, yMin, xMax, yMax } = anchorItemBounds;
  const centerX = (xMin + xMax) / 2;
  const centerY = (yMin + yMax) / 2;

  const anchors = [
    { ax: xMin,    ay: centerY }, // left edge
    { ax: xMax,    ay: centerY }, // right edge
    { ax: centerX, ay: yMin    }, // top edge
    { ax: centerX, ay: yMax    }, // bottom edge
    { ax: centerX, ay: centerY }, // center
  ];

  let nearest = { x, y, dist: Infinity };
  for (const a of anchors) {
    const dist = Math.sqrt((x - a.ax) ** 2 + (y - a.ay) ** 2);
    if (dist < nearest.dist) {
      nearest = { x: a.ax, y: a.ay, dist };
    }
  }

  if (nearest.dist <= snapDistanceCm) {
    return { x: nearest.x, y: nearest.y, snapped: true, snapType: "item_anchor" };
  }
  return { x, y, snapped: false, snapType: "none" };
}

// ── Tenant consistency ─────────────────────────────────────────────────────────

/**
 * Assert that placement tenant matches session tenant.
 * NULL-safe: NULL/NULL is allowed, any mismatch throws TENANT_MISMATCH.
 */
export function assertTenantConsistency(
  sessionTenantId: string | null | undefined,
  placementTenantId: string | null | undefined,
): void {
  const s = sessionTenantId ?? null;
  const p = placementTenantId ?? null;
  if (s === null && p === null) return;
  if (s !== null && p !== null && s === p) return;
  throw new PlacementEngineError(
    `Placement tenant_id (${p}) does not match session tenant_id (${s})`,
    "TENANT_MISMATCH",
    403,
  );
}

// ── Map DB trigger errors to structured errors ─────────────────────────────────

function mapDbError(err: unknown): never {
  const e = err as { message?: string; code?: string };
  const msg = e?.message ?? "";

  if (msg.includes("PLACEMENT_TENANT_MISMATCH")) {
    throw new PlacementEngineError(
      "Placement tenant does not match session tenant",
      "TENANT_MISMATCH",
      403,
    );
  }
  if (msg.includes("PLACEMENT_SESSION_NOT_FOUND")) {
    throw new PlacementEngineError(
      "Referenced layout session does not exist",
      "SESSION_NOT_FOUND",
      404,
    );
  }
  if (msg.includes("LAYOUT_SESSION_TENANT_LOCKED")) {
    throw new PlacementEngineError(
      "Cannot change session tenant while placements exist",
      "CONFLICT",
      409,
    );
  }
  throw err;
}

// ── Session CRUD ───────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  tenantId?: string | null;
  roomTemplateId?: string | null;
  name: string;
  coordinateUnit?: string;
  roomWidthCm: number;
  roomLengthCm: number;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface UpdateSessionInput {
  name?: string;
  roomWidthCm?: number;
  roomLengthCm?: number;
  metadata?: Record<string, unknown>;
}

export interface ListSessionsFilter {
  tenantId?: string | null;
  status?: "active" | "archived";
  search?: string;
  limit?: number;
  offset?: number;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<LayoutSession> {
  if (!input.name?.trim()) {
    throw new PlacementEngineError(
      "Session name is required",
      "INVALID_INPUT",
      400,
    );
  }
  if (!Number.isFinite(input.roomWidthCm) || input.roomWidthCm <= 0) {
    throw new PlacementEngineError(
      "roomWidthCm must be a positive number",
      "INVALID_INPUT",
      400,
    );
  }
  if (!Number.isFinite(input.roomLengthCm) || input.roomLengthCm <= 0) {
    throw new PlacementEngineError(
      "roomLengthCm must be a positive number",
      "INVALID_INPUT",
      400,
    );
  }

  const [session] = await db
    .insert(layoutSessionsTable)
    .values({
      tenantId: input.tenantId ?? null,
      roomTemplateId: input.roomTemplateId ?? null,
      name: input.name.trim(),
      coordinateUnit: input.coordinateUnit ?? "cm",
      roomWidthCm: String(input.roomWidthCm),
      roomLengthCm: String(input.roomLengthCm),
      metadata: input.metadata ?? {},
      createdBy: input.createdBy ?? "system",
    })
    .returning();

  return session!;
}

export async function getSession(sessionId: string): Promise<LayoutSession> {
  const [session] = await db
    .select()
    .from(layoutSessionsTable)
    .where(eq(layoutSessionsTable.id, sessionId))
    .limit(1);
  if (!session) {
    throw new PlacementEngineError(
      `Session ${sessionId} not found`,
      "NOT_FOUND",
      404,
    );
  }
  return session;
}

export async function listSessions(
  filter: ListSessionsFilter = {},
): Promise<{ sessions: LayoutSession[]; total: number }> {
  const { tenantId, status, search, limit = 50, offset = 0 } = filter;

  const conditions: ReturnType<typeof eq>[] = [];
  if (tenantId !== undefined) {
    conditions.push(
      tenantId === null
        ? (isNull(layoutSessionsTable.tenantId) as ReturnType<typeof eq>)
        : eq(layoutSessionsTable.tenantId, tenantId),
    );
  }
  if (status) {
    conditions.push(eq(layoutSessionsTable.status, status));
  }
  if (search) {
    conditions.push(
      ilike(layoutSessionsTable.name, `%${search}%`) as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [sessions, [{ count }]] = await Promise.all([
    db
      .select()
      .from(layoutSessionsTable)
      .where(where)
      .limit(Math.min(limit, 200))
      .offset(offset)
      .orderBy(desc(layoutSessionsTable.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(layoutSessionsTable)
      .where(where),
  ]);

  return { sessions, total: count ?? 0 };
}

export async function updateSession(
  sessionId: string,
  input: UpdateSessionInput,
): Promise<LayoutSession> {
  await getSession(sessionId);

  const updates: Partial<InsertLayoutSession> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    if (!input.name.trim()) {
      throw new PlacementEngineError(
        "Name cannot be empty",
        "INVALID_INPUT",
        400,
      );
    }
    updates.name = input.name.trim();
  }
  if (input.roomWidthCm !== undefined) {
    if (!Number.isFinite(input.roomWidthCm) || input.roomWidthCm <= 0) {
      throw new PlacementEngineError(
        "roomWidthCm must be a positive number",
        "INVALID_INPUT",
        400,
      );
    }
    updates.roomWidthCm = String(input.roomWidthCm);
  }
  if (input.roomLengthCm !== undefined) {
    if (!Number.isFinite(input.roomLengthCm) || input.roomLengthCm <= 0) {
      throw new PlacementEngineError(
        "roomLengthCm must be a positive number",
        "INVALID_INPUT",
        400,
      );
    }
    updates.roomLengthCm = String(input.roomLengthCm);
  }
  if (input.metadata !== undefined) {
    updates.metadata = input.metadata;
  }

  const [updated] = await db
    .update(layoutSessionsTable)
    .set(updates)
    .where(eq(layoutSessionsTable.id, sessionId))
    .returning();
  return updated!;
}

export async function archiveSession(sessionId: string): Promise<LayoutSession> {
  const existing = await getSession(sessionId);
  if (existing.status === "archived") return existing; // idempotent

  const [updated] = await db
    .update(layoutSessionsTable)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(layoutSessionsTable.id, sessionId))
    .returning();
  return updated!;
}

export async function restoreSession(sessionId: string): Promise<LayoutSession> {
  await getSession(sessionId);

  const [updated] = await db
    .update(layoutSessionsTable)
    .set({ status: "active", archivedAt: null, updatedAt: new Date() })
    .where(eq(layoutSessionsTable.id, sessionId))
    .returning();
  return updated!;
}

// ── Placement CRUD ─────────────────────────────────────────────────────────────

export interface CreatePlacementInput {
  tenantId?: string | null;
  furnitureItemId: string;
  xCm?: number;
  yCm?: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  rotationDeg?: number;
  anchorType?: string;
  anchorData?: Record<string, unknown>;
  snapType?: string;
  snapData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface MovePlacementInput {
  xCm: number;
  yCm: number;
  snapType?: string;
  snapData?: Record<string, unknown>;
}

export interface RotatePlacementInput {
  rotationDeg: number;
}

export interface ListPlacementsFilter {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export async function createPlacement(
  sessionId: string,
  input: CreatePlacementInput,
): Promise<Placement> {
  const session = await getSession(sessionId);
  if (session.status === "archived") {
    throw new PlacementEngineError(
      `Cannot add placement to archived session ${sessionId}`,
      "SESSION_ARCHIVED",
      409,
    );
  }
  if (!input.furnitureItemId) {
    throw new PlacementEngineError(
      "furnitureItemId is required",
      "INVALID_INPUT",
      400,
    );
  }

  const xCm = input.xCm ?? 0;
  const yCm = input.yCm ?? 0;
  validateCoordinates(xCm, yCm);
  validateDimensions(input.widthCm, input.depthCm, input.heightCm);
  assertTenantConsistency(session.tenantId, input.tenantId);

  const rotationDeg = normalizeRotation(input.rotationDeg ?? 0);

  try {
    const [placement] = await db
      .insert(placementsTable)
      .values({
        tenantId: input.tenantId ?? null,
        sessionId,
        furnitureItemId: input.furnitureItemId,
        xCm: String(xCm),
        yCm: String(yCm),
        widthCm: String(input.widthCm),
        depthCm: String(input.depthCm),
        heightCm: String(input.heightCm),
        rotationDeg: String(rotationDeg),
        anchorType: input.anchorType ?? "none",
        anchorData: input.anchorData ?? {},
        snapType: input.snapType ?? "none",
        snapData: input.snapData ?? {},
        metadata: input.metadata ?? {},
        version: 1,
        createdBy: input.createdBy ?? "system",
      })
      .returning();
    return placement!;
  } catch (err) {
    mapDbError(err);
  }
}

export async function getPlacement(
  sessionId: string,
  placementId: string,
): Promise<Placement> {
  const [placement] = await db
    .select()
    .from(placementsTable)
    .where(
      and(
        eq(placementsTable.id, placementId),
        eq(placementsTable.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (!placement) {
    throw new PlacementEngineError(
      `Placement ${placementId} not found`,
      "NOT_FOUND",
      404,
    );
  }
  return placement;
}

export async function listPlacements(
  sessionId: string,
  filter: ListPlacementsFilter = {},
): Promise<{ placements: Placement[]; total: number }> {
  const { includeArchived = false, limit = 200, offset = 0 } = filter;

  const conditions: ReturnType<typeof eq>[] = [
    eq(placementsTable.sessionId, sessionId),
  ];
  if (!includeArchived) {
    conditions.push(isNull(placementsTable.archivedAt) as ReturnType<typeof eq>);
  }
  const where = and(...conditions);

  const [placements, [{ count }]] = await Promise.all([
    db
      .select()
      .from(placementsTable)
      .where(where)
      .limit(Math.min(limit, 1000))
      .offset(offset)
      .orderBy(desc(placementsTable.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(placementsTable)
      .where(where),
  ]);

  return { placements, total: count ?? 0 };
}

export async function movePlacement(
  sessionId: string,
  placementId: string,
  input: MovePlacementInput,
): Promise<Placement> {
  await getSession(sessionId);
  const existing = await getPlacement(sessionId, placementId);
  validateCoordinates(input.xCm, input.yCm);

  const [updated] = await db
    .update(placementsTable)
    .set({
      xCm: String(input.xCm),
      yCm: String(input.yCm),
      snapType: input.snapType ?? existing.snapType,
      snapData: input.snapData ?? existing.snapData,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(placementsTable.id, placementId),
        eq(placementsTable.sessionId, sessionId),
      ),
    )
    .returning();
  return updated!;
}

export async function rotatePlacement(
  sessionId: string,
  placementId: string,
  input: RotatePlacementInput,
): Promise<Placement> {
  await getSession(sessionId);
  const existing = await getPlacement(sessionId, placementId);
  const rotationDeg = normalizeRotation(input.rotationDeg);

  const [updated] = await db
    .update(placementsTable)
    .set({
      rotationDeg: String(rotationDeg),
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(placementsTable.id, placementId),
        eq(placementsTable.sessionId, sessionId),
      ),
    )
    .returning();
  return updated!;
}

export async function duplicatePlacement(
  sessionId: string,
  placementId: string,
): Promise<Placement> {
  await getSession(sessionId);
  const source = await getPlacement(sessionId, placementId);

  try {
    const [newPlacement] = await db
      .insert(placementsTable)
      .values({
        tenantId: source.tenantId,
        sessionId: source.sessionId,
        furnitureItemId: source.furnitureItemId,
        xCm: String(Number(source.xCm) + 10),
        yCm: String(Number(source.yCm) + 10),
        widthCm: source.widthCm,
        depthCm: source.depthCm,
        heightCm: source.heightCm,
        rotationDeg: source.rotationDeg,
        anchorType: "none",
        anchorData: {},
        snapType: "none",
        snapData: {},
        metadata: {
          ...(source.metadata as Record<string, unknown>),
          duplicatedFrom: source.id,
        },
        version: 1,
        createdBy: source.createdBy,
      })
      .returning();
    return newPlacement!;
  } catch (err) {
    mapDbError(err);
  }
}

export async function archivePlacement(
  sessionId: string,
  placementId: string,
): Promise<Placement> {
  await getSession(sessionId);
  await getPlacement(sessionId, placementId);

  const [updated] = await db
    .update(placementsTable)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(placementsTable.id, placementId),
        eq(placementsTable.sessionId, sessionId),
      ),
    )
    .returning();
  return updated!;
}

export async function restorePlacement(
  sessionId: string,
  placementId: string,
): Promise<Placement> {
  await getSession(sessionId);

  const [existing] = await db
    .select()
    .from(placementsTable)
    .where(
      and(
        eq(placementsTable.id, placementId),
        eq(placementsTable.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new PlacementEngineError(
      `Placement ${placementId} not found`,
      "NOT_FOUND",
      404,
    );
  }

  const [updated] = await db
    .update(placementsTable)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(placementsTable.id, placementId),
        eq(placementsTable.sessionId, sessionId),
      ),
    )
    .returning();
  return updated!;
}
