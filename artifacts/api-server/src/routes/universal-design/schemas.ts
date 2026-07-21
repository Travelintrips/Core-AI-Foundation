/**
 * Team 10 — Universal Design API: Zod request/response schemas
 *
 * All schemas follow the @workspace/api-zod convention: Zod objects with
 * explicit field definitions. Internal DB fields (e.g. token hashes, raw
 * storage paths) are never included in response schemas — safe projection only.
 */
import { z } from "zod";

// ── Params ────────────────────────────────────────────────────────────────────

export const DesignProjectIdParams = z.object({
  id: z
    .string()
    .regex(/^\d+$/, "Project id must be a positive integer")
    .transform(Number),
});

export const PluginIdParams = z.object({
  pluginId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "pluginId must be lowercase alphanumeric with dashes"),
});

// ── Pagination ────────────────────────────────────────────────────────────────

export const PaginationQuery = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, parseInt(v, 10)) : 1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10))) : 20)),
});

export function paginatedResponse<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  });
}

// ── Plugin Manifest ───────────────────────────────────────────────────────────

export const ArtifactTypeDefinition = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string().optional(),
  mimeTypes: z.array(z.string()).optional(),
});

export const StageDefinition = z.object({
  stageId: z.string(),
  label: z.string(),
  order: z.number().int().nonnegative(),
  description: z.string().optional(),
});

export const PluginManifestResponse = z.object({
  pluginId: z.string(),
  name: z.string(),
  domain: z.string(),
  version: z.string(),
  briefSchemaRef: z.string(),
  workflowId: z.string(),
  capabilities: z.record(z.boolean()),
  artifactTypes: z.array(ArtifactTypeDefinition),
  stages: z.array(StageDefinition),
  featureFlags: z.record(z.boolean()).optional(),
  // Safe projection: no internal engine IDs, storage paths, or AI model names
});

// ── Project Config ────────────────────────────────────────────────────────────

export const DesignProjectConfigResponse = z.object({
  projectId: z.number(),
  pluginId: z.string(),
  manifest: PluginManifestResponse,
  briefSchemaVersion: z.string(),
  workflowStatus: z.string().nullable(),
  currentStage: z.string().nullable(),
});

// ── Project Overview ──────────────────────────────────────────────────────────

export const DesignProjectOverviewResponse = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  pluginId: z.string().nullable(),
  status: z.string(),
  currentStage: z.string().nullable(),
  canvasWidth: z.number(),
  canvasHeight: z.number(),
  thumbnailUrl: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Safe projection: canvasState JSONB not included (can be large; use artifacts endpoint)
});

// ── Brief ─────────────────────────────────────────────────────────────────────

export const SubmitBriefBody = z.object({
  /**
   * Normalized brief fields. Structure is validated against the plugin's
   * brief schema on the server. Unknown keys are stripped, not rejected,
   * to support additive schema evolution.
   */
  fields: z.record(z.unknown()),
  idempotencyKey: z.string().uuid().optional(),
});

export const SubmitBriefResponse = z.object({
  briefId: z.string(),
  projectId: z.number(),
  pluginId: z.string().nullable(),
  status: z.enum(["saved", "updated"]),
  version: z.number().int().nonnegative(),
  savedAt: z.string(),
});

// ── Initialize Workflow ───────────────────────────────────────────────────────

export const InitializeWorkflowBody = z.object({
  workflowId: z.string().min(1).max(128),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  idempotencyKey: z.string().uuid().optional(),
});

export const InitializeWorkflowResponse = z.object({
  projectId: z.number(),
  workflowId: z.string(),
  status: z.enum(["initialized", "already_running"]),
  jobId: z.string().nullable(),
  message: z.string(),
});

// ── Command ───────────────────────────────────────────────────────────────────

export const ProjectCommandBody = z.object({
  /**
   * Command verb. Must match a capability registered in the plugin manifest.
   * Examples: "regenerate_element", "apply_style", "export_pdf", "request_revision"
   */
  command: z.string().min(1).max(128),
  payload: z.record(z.unknown()).optional(),
  /**
   * Required idempotency key (UUID v4). Duplicate submissions with the same
   * key within the TTL window are responded to with the original outcome.
   */
  idempotencyKey: z.string().uuid(),
});

export const ProjectCommandResponse = z.object({
  accepted: z.boolean(),
  commandId: z.string(),
  idempotencyKey: z.string(),
  status: z.enum(["accepted", "conflict", "rejected"]),
  conflictReason: z.string().optional(),
  resultSummary: z.record(z.unknown()).optional(),
});

// ── Stages ────────────────────────────────────────────────────────────────────

export const StageItem = z.object({
  stageId: z.string(),
  label: z.string(),
  order: z.number().int().nonnegative(),
  status: z.enum(["pending", "active", "completed", "skipped", "failed"]),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const ListStagesResponse = paginatedResponse(StageItem);

// ── Artifacts ─────────────────────────────────────────────────────────────────

export const ArtifactItem = z.object({
  id: z.number(),
  type: z.string(),
  label: z.string().nullable(),
  version: z.number().int().nonnegative(),
  /** Signed public URL — never raw storage path */
  url: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  status: z.string(),
  mimeType: z.string().nullable(),
  createdAt: z.string(),
});

export const ListArtifactsResponse = paginatedResponse(ArtifactItem);

// ── Events / Activity ─────────────────────────────────────────────────────────

export const EventItem = z.object({
  eventId: z.string(),
  eventType: z.string(),
  /** Redacted actor identity — never raw email or internal user ID */
  actorRole: z.string().nullable(),
  summary: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  occurredAt: z.string(),
});

export const ListEventsResponse = paginatedResponse(EventItem);

// ── Review ────────────────────────────────────────────────────────────────────

export const RequestReviewBody = z.object({
  type: z.enum(["approval", "revision"]),
  notes: z.string().max(2000).optional(),
  clientName: z.string().max(120).optional(),
  clientEmail: z.string().email().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const RequestReviewResponse = z.object({
  reviewId: z.number().nullable(),
  /**
   * Plain review token — shown only once. The hash is stored in the DB;
   * the plain value is not persisted. Consumer must store it.
   */
  reviewToken: z.string().nullable(),
  reviewUrl: z.string().nullable(),
  status: z.enum(["created", "resent", "already_pending"]),
  message: z.string(),
});

// ── Typed error codes ─────────────────────────────────────────────────────────

export const DesignApiErrorCode = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "CONFLICT",
  "PLUGIN_NOT_SUPPORTED",
  "LIFECYCLE_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "INTERNAL_ERROR",
]);

export type DesignApiErrorCodeType = z.infer<typeof DesignApiErrorCode>;

export function errorResponse(
  code: DesignApiErrorCodeType,
  message: string,
  details?: unknown,
) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}
