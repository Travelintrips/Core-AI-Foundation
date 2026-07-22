/**
 * annotationService.ts — Team 18 / Universal Annotation and Comment System
 *
 * CRUD operations for ai_annotations. tenantId is always resolved from the
 * AnnotationActorContext — never from client-supplied input.
 */
import { db } from "@workspace/db";
import { aiAnnotationsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import {
  type CreateAnnotationInput,
  type UpdateAnnotationInput,
  type AnnotationSelection,
  type AnnotationActorContext,
  type AnnotationRecord,
  ANNOTATION_STATUSES,
} from "./types.js";
import {
  validateGeometry,
  clampAnchor,
} from "./geometry.js";
import {
  assertTenantMatch,
  canDeleteAnnotation,
  canResolveAnnotation,
  canReopenAnnotation,
  canAcknowledgeAnnotation,
  canArchiveAnnotation,
  AnnotationPermissionError,
} from "./annotationPermissionService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapRow(row: typeof aiAnnotationsTable.$inferSelect): AnnotationRecord {
  return {
    id:             row.id,
    tenantId:       row.tenantId,
    artifactId:     row.artifactId,
    artifactType:   row.artifactType,
    versionId:      row.versionId ?? null,
    frameId:        row.frameId ?? null,
    annotationType: row.annotationType as AnnotationRecord["annotationType"],
    geometry:       row.geometry as AnnotationRecord["geometry"],
    elementId:      row.elementId ?? null,
    title:          row.title ?? null,
    description:    row.description ?? null,
    status:         row.status as AnnotationRecord["status"],
    priority:       row.priority as AnnotationRecord["priority"],
    assigneeId:     row.assigneeId ?? null,
    assigneeName:   row.assigneeName ?? null,
    createdBy:      row.createdBy,
    createdByName:  row.createdByName,
    authorType:     row.authorType as AnnotationRecord["authorType"],
    isDeleted:      row.isDeleted,
    metadata:       (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt:      row.createdAt.toISOString(),
    updatedAt:      row.updatedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// createAnnotation
// ─────────────────────────────────────────────────────────────────────────────

export async function createAnnotation(
  input: CreateAnnotationInput,
  ctx: AnnotationActorContext,
): Promise<AnnotationRecord> {
  // Validate raw input before clamping — reject out-of-range values explicitly
  if (!validateGeometry(input.geometry)) {
    throw new Error("Invalid annotation geometry: coordinates out of range or missing required fields");
  }
  const geometry = clampAnchor(input.geometry);

  const [row] = await db
    .insert(aiAnnotationsTable)
    .values({
      tenantId:       ctx.tenantId,
      artifactId:     input.artifactId,
      artifactType:   input.artifactType,
      versionId:      input.versionId ?? null,
      frameId:        input.frameId ?? null,
      annotationType: input.annotationType ?? "point_pin",
      geometry:       geometry,
      elementId:      input.elementId ?? null,
      title:          input.title ?? null,
      description:    input.description ?? null,
      status:         "open",
      priority:       input.priority ?? "normal",
      assigneeId:     input.assigneeId ?? null,
      assigneeName:   input.assigneeName ?? null,
      // Actor identity from context — never from client payload
      createdBy:      ctx.actorId,
      createdByName:  ctx.actorName,
      authorType:     ctx.authorType,
      metadata:       input.metadata ?? null,
    })
    .returning();

  if (!row) throw new Error("Failed to create annotation");
  return mapRow(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// getAnnotation
// ─────────────────────────────────────────────────────────────────────────────

export async function getAnnotation(
  id: number,
  tenantId: string,
): Promise<AnnotationRecord | null> {
  const [row] = await db
    .select()
    .from(aiAnnotationsTable)
    .where(and(eq(aiAnnotationsTable.id, id), eq(aiAnnotationsTable.isDeleted, false)));

  if (!row) return null;
  assertTenantMatch(row.tenantId, tenantId);
  return mapRow(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// listAnnotations
// ─────────────────────────────────────────────────────────────────────────────

export async function listAnnotations(
  params: AnnotationSelection,
  tenantId: string,
): Promise<AnnotationRecord[]> {
  const conditions = [eq(aiAnnotationsTable.tenantId, tenantId)];

  if (!params.includeDeleted) {
    conditions.push(eq(aiAnnotationsTable.isDeleted, false));
  }
  if (params.artifactId) {
    conditions.push(eq(aiAnnotationsTable.artifactId, params.artifactId));
  }
  if (params.artifactType) {
    conditions.push(eq(aiAnnotationsTable.artifactType, params.artifactType));
  }
  if (params.versionId) {
    conditions.push(eq(aiAnnotationsTable.versionId, params.versionId));
  }
  if (params.frameId) {
    conditions.push(eq(aiAnnotationsTable.frameId, params.frameId));
  }
  if (params.status) {
    conditions.push(eq(aiAnnotationsTable.status, params.status));
  }
  if (params.priority) {
    conditions.push(eq(aiAnnotationsTable.priority, params.priority));
  }
  if (params.authorType) {
    conditions.push(eq(aiAnnotationsTable.authorType, params.authorType));
  }

  const rows = await db
    .select()
    .from(aiAnnotationsTable)
    .where(and(...conditions))
    .limit(params.limit)
    .offset(params.offset);

  return rows.map(mapRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// updateAnnotation — patch allowed fields (not status transitions)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateAnnotation(
  id: number,
  patch: UpdateAnnotationInput,
  ctx: AnnotationActorContext,
): Promise<AnnotationRecord> {
  const existing = await getAnnotation(id, ctx.tenantId);
  if (!existing) throw new AnnotationPermissionError("NOT_FOUND", "Annotation not found");

  const updates: Partial<typeof aiAnnotationsTable.$inferInsert> = {};
  if (patch.title       !== undefined) updates.title       = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.priority    !== undefined) updates.priority    = patch.priority;
  if (patch.assigneeId  !== undefined) updates.assigneeId  = patch.assigneeId;
  if (patch.assigneeName!== undefined) updates.assigneeName= patch.assigneeName;
  if (patch.geometry    !== undefined) {
    const g = clampAnchor(patch.geometry);
    if (!validateGeometry(g)) throw new Error("Invalid geometry in update");
    updates.geometry = g;
  }
  if (patch.metadata !== undefined) updates.metadata = patch.metadata;

  const [row] = await db
    .update(aiAnnotationsTable)
    .set(updates)
    .where(and(eq(aiAnnotationsTable.id, id), eq(aiAnnotationsTable.tenantId, ctx.tenantId)))
    .returning();

  if (!row) throw new Error("Annotation update failed");
  return mapRow(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────────────

async function transitionStatus(
  id: number,
  newStatus: (typeof ANNOTATION_STATUSES)[number],
  tenantId: string,
): Promise<AnnotationRecord> {
  const [row] = await db
    .update(aiAnnotationsTable)
    .set({ status: newStatus })
    .where(and(eq(aiAnnotationsTable.id, id), eq(aiAnnotationsTable.tenantId, tenantId)))
    .returning();
  if (!row) throw new Error("Status transition failed — annotation not found");
  return mapRow(row);
}

export async function resolveAnnotation(
  id: number,
  ctx: AnnotationActorContext,
): Promise<AnnotationRecord> {
  const ann = await getAnnotation(id, ctx.tenantId);
  if (!ann) throw new AnnotationPermissionError("NOT_FOUND", "Annotation not found");
  if (!canResolveAnnotation(ann, ctx)) {
    throw new AnnotationPermissionError("FORBIDDEN", `Cannot resolve annotation in status '${ann.status}'`);
  }
  return transitionStatus(id, "resolved", ctx.tenantId);
}

export async function reopenAnnotation(
  id: number,
  ctx: AnnotationActorContext,
): Promise<AnnotationRecord> {
  const ann = await getAnnotation(id, ctx.tenantId);
  if (!ann) throw new AnnotationPermissionError("NOT_FOUND", "Annotation not found");
  if (!canReopenAnnotation(ann, ctx)) {
    throw new AnnotationPermissionError("FORBIDDEN", `Cannot reopen annotation in status '${ann.status}'`);
  }
  return transitionStatus(id, "reopened", ctx.tenantId);
}

export async function acknowledgeAnnotation(
  id: number,
  ctx: AnnotationActorContext,
): Promise<AnnotationRecord> {
  const ann = await getAnnotation(id, ctx.tenantId);
  if (!ann) throw new AnnotationPermissionError("NOT_FOUND", "Annotation not found");
  if (!canAcknowledgeAnnotation(ann, ctx)) {
    throw new AnnotationPermissionError("FORBIDDEN", `Cannot acknowledge annotation in status '${ann.status}'`);
  }
  return transitionStatus(id, "acknowledged", ctx.tenantId);
}

export async function archiveAnnotation(
  id: number,
  ctx: AnnotationActorContext,
): Promise<AnnotationRecord> {
  const ann = await getAnnotation(id, ctx.tenantId);
  if (!ann) throw new AnnotationPermissionError("NOT_FOUND", "Annotation not found");
  if (!canArchiveAnnotation(ann, ctx)) {
    throw new AnnotationPermissionError("FORBIDDEN", "Only admins can archive resolved annotations");
  }
  return transitionStatus(id, "archived", ctx.tenantId);
}

// ─────────────────────────────────────────────────────────────────────────────
// softDeleteAnnotation
// ─────────────────────────────────────────────────────────────────────────────

export async function softDeleteAnnotation(
  id: number,
  ctx: AnnotationActorContext,
): Promise<void> {
  const ann = await getAnnotation(id, ctx.tenantId);
  if (!ann) throw new AnnotationPermissionError("NOT_FOUND", "Annotation not found");
  if (!canDeleteAnnotation(ann, ctx)) {
    throw new AnnotationPermissionError("FORBIDDEN", "Not authorized to delete this annotation");
  }

  await db
    .update(aiAnnotationsTable)
    .set({ isDeleted: true, deletedAt: new Date() })
    .where(and(eq(aiAnnotationsTable.id, id), eq(aiAnnotationsTable.tenantId, ctx.tenantId)));
}
