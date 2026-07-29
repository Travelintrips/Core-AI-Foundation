/**
 * WP-03A — Placement Engine Service
 *
 * Manages layout sessions and furniture placements within tenant-scoped
 * 2D design canvases.
 *
 * Contracts:
 * - Tenant isolation: tenantId always comes from trusted RequestContext, never body.
 * - Rotation normalisation: all rotations stored in [0, 360).
 * - Archived placements are excluded from collision input (WP-03B reads isArchived).
 * - No SQL leakage in error messages.
 */

import { db } from "@workspace/db";
import {
  layoutSessionsTable,
  placementsTable,
  type LayoutSession,
  type Placement,
} from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";

// ── Error class ───────────────────────────────────────────────────────────────

export class PlacementEngineError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "PlacementEngineError";
    this.code = code;
    this.status = status;
  }
}

// ── Rotation normalisation ────────────────────────────────────────────────────

/**
 * Normalises any rotation angle (degrees) to [0, 360).
 * Handles negative values and values ≥ 360.
 */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) {
    throw new PlacementEngineError(
      "Rotation must be a finite number.",
      "INVALID_ROTATION",
      400,
    );
  }
  const mod = deg % 360;
  // Handle -0 (e.g. -360 % 360 = -0 in JS) — convert to +0
  const result = mod < 0 ? mod + 360 : mod;
  return result === 0 ? 0 : result;
}

// ── Anchor snap ───────────────────────────────────────────────────────────────

/**
 * Returns the absolute canvas position (xCm, yCm) of the placement anchor
 * given the top-left corner position and bounding box dimensions.
 *
 * anchorX / anchorY are in [0, 1] — e.g. (0.5, 0.5) is the center.
 */
export function snapToItemAnchor(
  xCm: number,
  yCm: number,
  widthCm: number,
  depthCm: number,
  anchorX: number,
  anchorY: number,
): { x: number; y: number } {
  return {
    x: xCm + anchorX * widthCm,
    y: yCm + anchorY * depthCm,
  };
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  tenantId: string;
  name: string;
  roomTemplateId?: string | null;
  widthCm?: number;
  depthCm?: number;
  heightCm?: number;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionInput {
  name?: string;
  widthCm?: number;
  depthCm?: number;
  heightCm?: number;
  metadata?: Record<string, unknown>;
}

export interface CreatePlacementInput {
  sessionId: string;
  tenantId: string;
  furnitureItemId?: string | null;
  label?: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  rotationDeg?: number;
  anchorX?: number;
  anchorY?: number;
  clearanceFrontCm?: number;
  clearanceSideCm?: number;
  clearanceBackCm?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdatePlacementInput {
  label?: string;
  xCm?: number;
  yCm?: number;
  widthCm?: number;
  depthCm?: number;
  rotationDeg?: number;
  anchorX?: number;
  anchorY?: number;
  clearanceFrontCm?: number;
  clearanceSideCm?: number;
  clearanceBackCm?: number;
  metadata?: Record<string, unknown>;
}

// ── Session helpers ───────────────────────────────────────────────────────────

function assertSessionAccess(session: LayoutSession | undefined, tenantId: string, sessionId: string): LayoutSession {
  if (!session || session.tenantId !== tenantId || session.deletedAt !== null) {
    throw new PlacementEngineError(
      `Layout session not found.`,
      "SESSION_NOT_FOUND",
      404,
    );
  }
  return session;
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

export async function createLayoutSession(input: CreateSessionInput): Promise<LayoutSession> {
  const { tenantId, name, roomTemplateId, widthCm, depthCm, heightCm, createdBy, metadata } = input;

  if (!name?.trim()) {
    throw new PlacementEngineError("Session name is required.", "VALIDATION_ERROR");
  }

  const [session] = await db
    .insert(layoutSessionsTable)
    .values({
      tenantId,
      name: name.trim(),
      roomTemplateId: roomTemplateId ?? null,
      widthCm: widthCm != null ? String(widthCm) : "400",
      depthCm: depthCm != null ? String(depthCm) : "500",
      heightCm: heightCm != null ? String(heightCm) : "270",
      createdBy: createdBy ?? "system",
      metadata: metadata ?? {},
    })
    .returning();

  if (!session) throw new PlacementEngineError("Failed to create session.", "CREATE_FAILED", 500);
  return session;
}

export async function getLayoutSession(sessionId: string, tenantId: string): Promise<LayoutSession> {
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

  return assertSessionAccess(session, tenantId, sessionId);
}

export async function listLayoutSessions(
  tenantId: string,
  opts?: { status?: string; page?: number; pageSize?: number },
): Promise<{ data: LayoutSession[]; total: number; page: number; pageSize: number }> {
  const page     = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 20));
  const offset   = (page - 1) * pageSize;

  const conditions = [
    eq(layoutSessionsTable.tenantId, tenantId),
    isNull(layoutSessionsTable.deletedAt),
  ];
  if (opts?.status) {
    conditions.push(eq(layoutSessionsTable.status, opts.status));
  }

  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<string>`count(*)` })
    .from(layoutSessionsTable)
    .where(where);

  const data = await db
    .select()
    .from(layoutSessionsTable)
    .where(where)
    .orderBy(layoutSessionsTable.updatedAt)
    .limit(pageSize)
    .offset(offset);

  return { data, total: parseInt(countRow?.count ?? "0", 10), page, pageSize };
}

export async function updateLayoutSession(
  sessionId: string,
  tenantId: string,
  input: UpdateSessionInput,
): Promise<LayoutSession> {
  const session = await getLayoutSession(sessionId, tenantId);

  if (session.status === "archived") {
    throw new PlacementEngineError("Cannot edit an archived session.", "SESSION_ARCHIVED", 409);
  }

  const updateData: Partial<typeof layoutSessionsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name != null)     updateData.name     = input.name.trim();
  if (input.widthCm  != null) updateData.widthCm  = String(input.widthCm);
  if (input.depthCm  != null) updateData.depthCm  = String(input.depthCm);
  if (input.heightCm != null) updateData.heightCm = String(input.heightCm);
  if (input.metadata != null) updateData.metadata = input.metadata;

  const [updated] = await db
    .update(layoutSessionsTable)
    .set(updateData)
    .where(eq(layoutSessionsTable.id, sessionId))
    .returning();

  if (!updated) throw new PlacementEngineError("Session update failed.", "UPDATE_FAILED", 500);
  return updated;
}

export async function archiveLayoutSession(sessionId: string, tenantId: string): Promise<LayoutSession> {
  const session = await getLayoutSession(sessionId, tenantId);
  if (session.status === "archived") {
    throw new PlacementEngineError("Session is already archived.", "ALREADY_ARCHIVED", 409);
  }
  const [updated] = await db
    .update(layoutSessionsTable)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(layoutSessionsTable.id, sessionId))
    .returning();
  if (!updated) throw new PlacementEngineError("Archive failed.", "ARCHIVE_FAILED", 500);
  return updated;
}

export async function restoreLayoutSession(sessionId: string, tenantId: string): Promise<LayoutSession> {
  const [session] = await db
    .select()
    .from(layoutSessionsTable)
    .where(and(eq(layoutSessionsTable.id, sessionId), eq(layoutSessionsTable.tenantId, tenantId)))
    .limit(1);

  if (!session) throw new PlacementEngineError("Layout session not found.", "SESSION_NOT_FOUND", 404);
  if (session.status !== "archived") {
    throw new PlacementEngineError("Session is not archived.", "NOT_ARCHIVED", 409);
  }

  const [updated] = await db
    .update(layoutSessionsTable)
    .set({ status: "draft", archivedAt: null, updatedAt: new Date() })
    .where(eq(layoutSessionsTable.id, sessionId))
    .returning();
  if (!updated) throw new PlacementEngineError("Restore failed.", "RESTORE_FAILED", 500);
  return updated;
}

export async function softDeleteLayoutSession(sessionId: string, tenantId: string): Promise<void> {
  const session = await getLayoutSession(sessionId, tenantId);
  if (session.deletedAt) throw new PlacementEngineError("Session is already deleted.", "ALREADY_DELETED", 409);
  await db
    .update(layoutSessionsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(layoutSessionsTable.id, sessionId));
}

// ── Placement CRUD ────────────────────────────────────────────────────────────

function validatePlacementDimensions(widthCm: number, depthCm: number): void {
  if (widthCm <= 0 || depthCm <= 0) {
    throw new PlacementEngineError(
      "Placement dimensions must be positive.",
      "INVALID_DIMENSIONS",
    );
  }
  if (!Number.isFinite(widthCm) || !Number.isFinite(depthCm)) {
    throw new PlacementEngineError(
      "Placement dimensions must be finite numbers.",
      "INVALID_DIMENSIONS",
    );
  }
}

export async function createPlacement(input: CreatePlacementInput): Promise<Placement> {
  // Verify session belongs to tenant (access control)
  await getLayoutSession(input.sessionId, input.tenantId);

  if (input.widthCm != null && input.depthCm != null) {
    validatePlacementDimensions(input.widthCm, input.depthCm);
  }

  const rotation = normalizeRotation(input.rotationDeg ?? 0);

  const [placement] = await db
    .insert(placementsTable)
    .values({
      sessionId:         input.sessionId,
      tenantId:          input.tenantId,
      furnitureItemId:   input.furnitureItemId ?? null,
      label:             input.label ?? "",
      xCm:               String(input.xCm),
      yCm:               String(input.yCm),
      widthCm:           String(input.widthCm),
      depthCm:           String(input.depthCm),
      rotationDeg:       String(rotation),
      anchorX:           String(input.anchorX ?? 0),
      anchorY:           String(input.anchorY ?? 0),
      clearanceFrontCm:  String(input.clearanceFrontCm ?? 0),
      clearanceSideCm:   String(input.clearanceSideCm  ?? 0),
      clearanceBackCm:   String(input.clearanceBackCm  ?? 0),
      metadata:          input.metadata ?? {},
    })
    .returning();

  if (!placement) throw new PlacementEngineError("Failed to create placement.", "CREATE_FAILED", 500);
  return placement;
}

export async function getPlacement(
  placementId: string,
  sessionId: string,
  tenantId: string,
): Promise<Placement> {
  // Access control: verify session first
  await getLayoutSession(sessionId, tenantId);

  const [placement] = await db
    .select()
    .from(placementsTable)
    .where(
      and(
        eq(placementsTable.id, placementId),
        eq(placementsTable.sessionId, sessionId),
        eq(placementsTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!placement) {
    throw new PlacementEngineError("Placement not found.", "PLACEMENT_NOT_FOUND", 404);
  }
  return placement;
}

export async function listPlacements(
  sessionId: string,
  tenantId: string,
  opts?: { includeArchived?: boolean },
): Promise<Placement[]> {
  // Access control
  await getLayoutSession(sessionId, tenantId);

  const conditions = [
    eq(placementsTable.sessionId, sessionId),
    eq(placementsTable.tenantId, tenantId),
  ];
  if (!opts?.includeArchived) {
    conditions.push(eq(placementsTable.isArchived, false));
  }

  return db
    .select()
    .from(placementsTable)
    .where(and(...conditions))
    .orderBy(placementsTable.createdAt);
}

export async function updatePlacement(
  placementId: string,
  sessionId: string,
  tenantId: string,
  input: UpdatePlacementInput,
): Promise<Placement> {
  const existing = await getPlacement(placementId, sessionId, tenantId);

  if (existing.isArchived) {
    throw new PlacementEngineError("Cannot edit an archived placement.", "PLACEMENT_ARCHIVED", 409);
  }

  const newWidth  = input.widthCm  ?? parseFloat(String(existing.widthCm));
  const newDepth  = input.depthCm  ?? parseFloat(String(existing.depthCm));
  validatePlacementDimensions(newWidth, newDepth);

  const updateData: Partial<typeof placementsTable.$inferInsert> = {
    version:   existing.version + 1,
    updatedAt: new Date(),
  };

  if (input.label     != null) updateData.label     = input.label;
  if (input.xCm       != null) updateData.xCm       = String(input.xCm);
  if (input.yCm       != null) updateData.yCm       = String(input.yCm);
  if (input.widthCm   != null) updateData.widthCm   = String(input.widthCm);
  if (input.depthCm   != null) updateData.depthCm   = String(input.depthCm);
  if (input.anchorX   != null) updateData.anchorX   = String(input.anchorX);
  if (input.anchorY   != null) updateData.anchorY   = String(input.anchorY);
  if (input.clearanceFrontCm != null) updateData.clearanceFrontCm = String(input.clearanceFrontCm);
  if (input.clearanceSideCm  != null) updateData.clearanceSideCm  = String(input.clearanceSideCm);
  if (input.clearanceBackCm  != null) updateData.clearanceBackCm  = String(input.clearanceBackCm);
  if (input.metadata  != null) updateData.metadata  = input.metadata;
  if (input.rotationDeg != null) {
    updateData.rotationDeg = String(normalizeRotation(input.rotationDeg));
  }

  const [updated] = await db
    .update(placementsTable)
    .set(updateData)
    .where(eq(placementsTable.id, placementId))
    .returning();

  if (!updated) throw new PlacementEngineError("Placement update failed.", "UPDATE_FAILED", 500);
  return updated;
}

export async function archivePlacement(
  placementId: string,
  sessionId: string,
  tenantId: string,
): Promise<Placement> {
  const existing = await getPlacement(placementId, sessionId, tenantId);
  if (existing.isArchived) {
    throw new PlacementEngineError("Placement is already archived.", "ALREADY_ARCHIVED", 409);
  }
  const [updated] = await db
    .update(placementsTable)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(eq(placementsTable.id, placementId))
    .returning();
  if (!updated) throw new PlacementEngineError("Archive failed.", "ARCHIVE_FAILED", 500);
  return updated;
}

export async function deletePlacement(
  placementId: string,
  sessionId: string,
  tenantId: string,
): Promise<void> {
  await getPlacement(placementId, sessionId, tenantId); // access control
  await db
    .delete(placementsTable)
    .where(eq(placementsTable.id, placementId));
}
