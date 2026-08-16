/**
 * routes/design-versioning.ts — Team 09: Design Version History & Revision System
 *
 * Mount point: all routes are prefixed /ai/design-versioning
 * (applied when this router is mounted in routes/index.ts).
 *
 * Auth model:
 *  - All endpoints require admin API key (adminAuth middleware via the global
 *    adminAuthWithExceptions mounted on /api in app.ts).
 *  - tenantId is resolved from the authenticated internal user context —
 *    never accepted from the request body / query params.
 *
 * Tenant resolution:
 *  - Routes create a RequestContext with tenantId from req.internalUser or
 *    fall back to the x-tenant-id header (admin-only, validated).
 *  - The RepositoryContext wraps this for all service calls.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { VERSIONABLE_ENTITY_TYPES, VERSION_ACTOR_TYPES, REVISION_REASONS } from "@workspace/db";
import {
  createVersion,
  approveVersion,
  promoteVersion,
  restoreVersion,
  listVersions,
  getVersion,
  diffVersions,
  linkVersionToReview,
  VersionImmutableError,
  VersionNotFoundError,
  VersionEntityTypeMismatchError,
  InvalidEntityTypeError,
} from "../services/design-versioning/designVersionService.js";
import { JsonDiffInputError } from "../services/design-versioning/jsonDiff.js";
import type { RepositoryContext } from "../repositories/types.js";
import type { RequestContext } from "../security/requestContext.js";

const router = Router();

// ── Request context builder ───────────────────────────────────────────────────
// Builds a minimal RepositoryContext from the Express request.
// tenantId comes from: 1) internalUser.tenantId 2) x-tenant-id header (admin)
// 3) falls back to "default" for platform-admin operations.

function buildRepoCtx(req: Request): RepositoryContext {
  const internalUser = (req as Request & { internalUser?: { tenantId?: string; id?: string } })
    .internalUser;
  const tenantId: string =
    internalUser?.tenantId ??
    (req.headers["x-tenant-id"] as string | undefined) ??
    "default";

  const requestContext: RequestContext = {
    tenantId,
    actorId:             internalUser?.id ?? null,
    actorType:           "platform_admin",
    authMode:            "bearer",
    requestId:           (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID(),
    correlationId:       (req.headers["x-correlation-id"] as string | undefined) ?? crypto.randomUUID(),
    source:              "admin_portal",
    permissions:         [],
    resourceScope:       null,
    isPlatformAdmin:     true,
    isPlatformWide:      false,
    originatingActorId:  null,
    metadata:            {},
  };

  return { requestContext };
}

// ── Error handler ─────────────────────────────────────────────────────────────

function handleError(err: unknown, res: Response): void {
  if (err instanceof VersionNotFoundError)             { res.status(404).json({ error: err.message }); return; }
  if (err instanceof VersionImmutableError)            { res.status(409).json({ error: err.message }); return; }
  if (err instanceof VersionEntityTypeMismatchError)   { res.status(422).json({ error: err.message }); return; }
  if (err instanceof InvalidEntityTypeError)           { res.status(400).json({ error: err.message }); return; }
  if (err instanceof JsonDiffInputError)               { res.status(422).json({ error: err.message }); return; }
  if (err instanceof z.ZodError)                       { res.status(400).json({ error: "Validation error", details: err.issues }); return; }
  console.error("[design-versioning] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createVersionSchema = z.object({
  entityType:      z.enum(VERSIONABLE_ENTITY_TYPES),
  entityId:        z.string().min(1),
  contentSnapshot: z.record(z.string(), z.unknown()),
  revisionReason:  z.enum(REVISION_REASONS).optional(),
  reason:          z.string().max(500).optional(),
  actorId:         z.string().max(200).optional(),
  actorType:       z.enum(VERSION_ACTOR_TYPES).optional(),
  aiJobId:         z.string().max(200).optional(),
  aiModel:         z.string().max(200).optional(),
  parentVersionId: z.number().int().positive().optional(),
  idempotencyKey:  z.string().max(200).optional(),
  reviewId:        z.number().int().positive().optional(),
});

const approveSchema = z.object({
  approvedBy: z.string().min(1).max(200),
});

const promoteSchema = z.object({
  actorId: z.string().max(200).optional(),
});

const restoreSchema = z.object({
  actorId: z.string().max(200).optional(),
  reason:  z.string().max(500).optional(),
});

const linkReviewSchema = z.object({
  reviewId: z.number().int().positive(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /ai/design-versioning/versions
 * Create a new version (idempotent if idempotencyKey provided).
 */
router.post("/ai/design-versioning/versions", async (req: Request, res: Response): Promise<void> => {
  try {
    const input = createVersionSchema.parse(req.body);
    const ctx   = buildRepoCtx(req);
    const version = await createVersion(input, ctx);
    res.status(201).json({ version });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * GET /ai/design-versioning/versions/v/:id
 * Get a single version by id.
 * NOTE: must be registered BEFORE /:entityType/:entityId to avoid Express
 * matching the literal segment "v" as the entityType parameter.
 */
router.get("/ai/design-versioning/versions/v/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "id must be an integer" }); return; }
    const ctx     = buildRepoCtx(req);
    const version = await getVersion(id, ctx);
    res.json({ version });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * GET /ai/design-versioning/versions/:entityType/:entityId
 * List all active versions for an entity, newest first.
 */
router.get(
  "/ai/design-versioning/versions/:entityType/:entityId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { entityType, entityId } = req.params as { entityType: string; entityId: string };
      const ctx = buildRepoCtx(req);
      const versions = await listVersions(entityType, entityId, ctx);
      res.json({ versions, count: versions.length });
    } catch (err) {
      handleError(err, res);
    }
  },
);

/**
 * POST /ai/design-versioning/versions/:id/approve
 * Approve a version — marks it as immutable.
 */
router.post(
  "/ai/design-versioning/versions/:id/approve",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id    = parseInt(req.params.id as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "id must be an integer" }); return; }
      const body  = approveSchema.parse(req.body);
      const ctx   = buildRepoCtx(req);
      const version = await approveVersion({ versionId: id, approvedBy: body.approvedBy }, ctx);
      res.json({ version });
    } catch (err) {
      handleError(err, res);
    }
  },
);

/**
 * POST /ai/design-versioning/versions/:id/promote
 * Promote a version to "current" (atomic).
 */
router.post(
  "/ai/design-versioning/versions/:id/promote",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id   = parseInt(req.params.id as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "id must be an integer" }); return; }
      const body = promoteSchema.parse(req.body ?? {});
      const ctx  = buildRepoCtx(req);
      const version = await promoteVersion({ versionId: id, actorId: body.actorId }, ctx);
      res.json({ version });
    } catch (err) {
      handleError(err, res);
    }
  },
);

/**
 * POST /ai/design-versioning/versions/:id/restore
 * Restore an old version by creating a new version with the same content.
 */
router.post(
  "/ai/design-versioning/versions/:id/restore",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id   = parseInt(req.params.id as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "id must be an integer" }); return; }
      const body = restoreSchema.parse(req.body ?? {});
      const ctx  = buildRepoCtx(req);
      const version = await restoreVersion(
        { fromVersionId: id, actorId: body.actorId, reason: body.reason },
        ctx,
      );
      res.status(201).json({ version });
    } catch (err) {
      handleError(err, res);
    }
  },
);

/**
 * GET /ai/design-versioning/diff/:idA/:idB
 * Structured JSON diff between two versions of the same entity.
 */
router.get(
  "/ai/design-versioning/diff/:idA/:idB",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const idA = parseInt(req.params.idA as string, 10);
      const idB = parseInt(req.params.idB as string, 10);
      if (isNaN(idA) || isNaN(idB)) {
        res.status(400).json({ error: "idA and idB must be integers" }); return;
      }
      const ctx  = buildRepoCtx(req);
      const diff = await diffVersions(idA, idB, ctx);
      res.json({ diff });
    } catch (err) {
      handleError(err, res);
    }
  },
);

/**
 * PATCH /ai/design-versioning/versions/:id/review-link
 * Additively link a version to a client review record.
 */
router.patch(
  "/ai/design-versioning/versions/:id/review-link",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id   = parseInt(req.params.id as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "id must be an integer" }); return; }
      const body = linkReviewSchema.parse(req.body);
      const ctx  = buildRepoCtx(req);
      const version = await linkVersionToReview({ versionId: id, reviewId: body.reviewId }, ctx);
      res.json({ version });
    } catch (err) {
      handleError(err, res);
    }
  },
);

export default router;
