/**
 * types.ts — Team 18 / Universal Annotation and Comment System
 *
 * All canonical TypeScript types and Zod schemas for the annotation domain.
 * Geometry uses normalized coordinates (0–1 range) so annotations survive
 * viewport / resolution changes.
 */
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

export const ANNOTATION_TYPES = ["point_pin", "rectangle", "region"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export const ANNOTATION_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "reopened",
  "archived",
] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

export const ANNOTATION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type AnnotationPriority = (typeof ANNOTATION_PRIORITIES)[number];

export const AUTHOR_TYPES = ["admin", "client"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationGeometry — normalized coordinates, bounding box, or region
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized coordinates are in [0, 1] relative to the artifact's content
 * area. Use geometry utilities to convert to/from pixel coordinates.
 */
export const AnnotationGeometrySchema = z.object({
  /** Type discriminant matches the parent annotation's annotationType */
  type: z.enum(["point_pin", "rectangle", "region"]),
  /** Normalized x — 0 = left edge, 1 = right edge */
  nx: z.number().min(0).max(1),
  /** Normalized y — 0 = top edge, 1 = bottom edge */
  ny: z.number().min(0).max(1),
  /** Normalized width (rectangle/region only) */
  nw: z.number().min(0).max(1).optional(),
  /** Normalized height (rectangle/region only) */
  nh: z.number().min(0).max(1).optional(),
  /** Optional opaque region descriptor for non-rectangular regions */
  regionDescriptor: z.string().optional(),
});
export type AnnotationGeometry = z.infer<typeof AnnotationGeometrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationAnchor — what the annotation points to
// ─────────────────────────────────────────────────────────────────────────────

export const AnnotationAnchorSchema = z.object({
  artifactId:   z.string().min(1),
  artifactType: z.string().min(1),
  versionId:    z.string().optional(),
  frameId:      z.string().optional(),
  elementId:    z.string().optional(),
});
export type AnnotationAnchor = z.infer<typeof AnnotationAnchorSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationPermission — who may perform which operations
// ─────────────────────────────────────────────────────────────────────────────

export interface AnnotationPermission {
  canCreate:  boolean;
  canResolve: boolean;
  canReopen:  boolean;
  canArchive: boolean;
  canDelete:  boolean;
  canEditOwn: boolean;
  canAssign:  boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationComment
// ─────────────────────────────────────────────────────────────────────────────

export const AnnotationCommentSchema = z.object({
  id:              z.number().int().positive(),
  annotationId:    z.number().int().positive(),
  parentCommentId: z.number().int().positive().nullable(),
  body:            z.string().min(1).max(8000),
  authorType:      z.enum(AUTHOR_TYPES),
  createdBy:       z.string().min(1),
  createdByName:   z.string().min(1),
  editedAt:        z.string().nullable(),
  isDeleted:       z.boolean(),
  createdAt:       z.string(),
  updatedAt:       z.string(),
});
export type AnnotationComment = z.infer<typeof AnnotationCommentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationThread — annotation + all its comments
// ─────────────────────────────────────────────────────────────────────────────

export interface AnnotationThread {
  annotation: AnnotationRecord;
  comments:   AnnotationComment[];
}

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationRecord — the full annotation (DB row mapped to typed output)
// ─────────────────────────────────────────────────────────────────────────────

export interface AnnotationRecord {
  id:             number;
  tenantId:       string;
  artifactId:     string;
  artifactType:   string;
  versionId:      string | null;
  frameId:        string | null;
  annotationType: AnnotationType;
  geometry:       AnnotationGeometry;
  elementId:      string | null;
  title:          string | null;
  description:    string | null;
  status:         AnnotationStatus;
  priority:       AnnotationPriority;
  assigneeId:     string | null;
  assigneeName:   string | null;
  createdBy:      string;
  createdByName:  string;
  authorType:     AuthorType;
  isDeleted:      boolean;
  metadata:       Record<string, unknown> | null;
  createdAt:      string;
  updatedAt:      string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationMutation — input schemas validated at the service boundary
// ─────────────────────────────────────────────────────────────────────────────

export const CreateAnnotationSchema = z.object({
  artifactId:      z.string().min(1),
  artifactType:    z.string().min(1),
  versionId:       z.string().optional(),
  frameId:         z.string().optional(),
  annotationType:  z.enum(ANNOTATION_TYPES).optional().default("point_pin"),
  geometry:        AnnotationGeometrySchema,
  elementId:       z.string().optional(),
  title:           z.string().max(500).optional(),
  description:     z.string().max(4000).optional(),
  priority:        z.enum(ANNOTATION_PRIORITIES).optional().default("normal"),
  assigneeId:      z.string().optional(),
  assigneeName:    z.string().optional(),
  metadata:        z.record(z.string(), z.unknown()).optional(),
});
export type CreateAnnotationInput = z.infer<typeof CreateAnnotationSchema>;

export const UpdateAnnotationSchema = z.object({
  title:       z.string().max(500).optional(),
  description: z.string().max(4000).optional(),
  priority:    z.enum(ANNOTATION_PRIORITIES).optional(),
  assigneeId:  z.string().nullable().optional(),
  assigneeName:z.string().nullable().optional(),
  geometry:    AnnotationGeometrySchema.optional(),
  metadata:    z.record(z.string(), z.unknown()).optional(),
});
export type UpdateAnnotationInput = z.infer<typeof UpdateAnnotationSchema>;

export const CreateCommentSchema = z.object({
  body:            z.string().min(1).max(8000),
  parentCommentId: z.number().int().positive().optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

export const EditCommentSchema = z.object({
  body: z.string().min(1).max(8000),
});
export type EditCommentInput = z.infer<typeof EditCommentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// AnnotationSelection — filter params for listing annotations
// ─────────────────────────────────────────────────────────────────────────────

export const AnnotationSelectionSchema = z.object({
  artifactId:   z.string().optional(),
  artifactType: z.string().optional(),
  versionId:    z.string().optional(),
  frameId:      z.string().optional(),
  status:       z.enum(ANNOTATION_STATUSES).optional(),
  priority:     z.enum(ANNOTATION_PRIORITIES).optional(),
  authorType:   z.enum(AUTHOR_TYPES).optional(),
  includeDeleted: z.boolean().default(false),
  limit:        z.number().int().min(1).max(200).default(50),
  offset:       z.number().int().min(0).default(0),
});
export type AnnotationSelection = z.infer<typeof AnnotationSelectionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Actor context — resolved server-side, never from client payload
// ─────────────────────────────────────────────────────────────────────────────

export interface AnnotationActorContext {
  tenantId:       string;
  actorId:        string;
  actorName:      string;
  authorType:     AuthorType;
  isPlatformAdmin: boolean;
}
