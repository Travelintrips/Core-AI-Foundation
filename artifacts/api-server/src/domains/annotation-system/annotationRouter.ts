/**
 * annotationRouter.ts — Team 18 / Universal Annotation and Comment System
 *
 * Admin routes (x-admin-api-key via global adminAuthWithExceptions):
 *   GET    /ai/annotations                      list/filter
 *   POST   /ai/annotations                      create
 *   GET    /ai/annotations/:id                  get one
 *   PATCH  /ai/annotations/:id                  update fields
 *   DELETE /ai/annotations/:id                  soft delete
 *   POST   /ai/annotations/:id/resolve          resolve
 *   POST   /ai/annotations/:id/reopen           reopen
 *   POST   /ai/annotations/:id/acknowledge      acknowledge
 *   POST   /ai/annotations/:id/archive          archive
 *   GET    /ai/annotations/:id/comments         get thread
 *   POST   /ai/annotations/:id/comments         add comment
 *   PATCH  /ai/annotations/:id/comments/:cid    edit comment
 *   DELETE /ai/annotations/:id/comments/:cid    delete comment
 *
 * Public (token-based client review) routes:
 *   GET    /public/review-annotations/:token             list for review
 *   POST   /public/review-annotations/:token             create
 *   GET    /public/review-annotations/:token/:id         get one
 *   POST   /public/review-annotations/:token/:id/comments add comment
 *
 * Security:
 *   - tenantId from server context only (DEFAULT_TENANT_ID / resolved context)
 *   - actor identity from API key / workspace token — never from client body
 *   - HTML sanitized in thread service before storage
 *   - No token exposure in responses
 */
import { Router, type Request, type Response } from "express";
import { adminAuth } from "../../middleware/adminAuth.js";
import { resolveWorkspaceSession } from "../../services/customerWorkspaceService.js";
import { DEFAULT_TENANT_ID } from "../../security/tenantResolution.js";
import {
  CreateAnnotationSchema,
  UpdateAnnotationSchema,
  CreateCommentSchema,
  EditCommentSchema,
  AnnotationSelectionSchema,
  type AnnotationActorContext,
} from "./types.js";
import {
  createAnnotation,
  getAnnotation,
  listAnnotations,
  updateAnnotation,
  softDeleteAnnotation,
  resolveAnnotation,
  reopenAnnotation,
  acknowledgeAnnotation,
  archiveAnnotation,
} from "./annotationService.js";
import {
  getThread,
  addComment,
  editComment,
  deleteComment,
} from "./annotationThreadService.js";
import { AnnotationPermissionError, buildActorContext } from "./annotationPermissionService.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function intParam(req: Request, name: string): number | null {
  const v = parseInt(String(req.params[name] ?? ""), 10);
  return isNaN(v) ? null : v;
}

function errRes(res: Response, status: number, msg: string): void {
  res.status(status).json({ error: msg });
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof AnnotationPermissionError) {
    const statusMap: Record<string, number> = {
      NOT_FOUND:            404,
      FORBIDDEN:            403,
      TENANT_MISMATCH:      403,
      CROSS_PROJECT_ANCHOR: 400,
      MISSING_TENANT:       400,
      MISSING_ACTOR:        400,
      INVALID_PARENT:       400,
    };
    const status = statusMap[err.code] ?? 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: "Internal error" });
}

/** Build admin actor context from authenticated request (API key path). */
function adminCtx(req: Request): AnnotationActorContext {
  return buildActorContext(
    DEFAULT_TENANT_ID,
    // Use the x-actor-id header if present (internal services may set it),
    // otherwise fall back to a static admin identifier.
    String(req.headers["x-actor-id"] ?? "admin"),
    String(req.headers["x-actor-name"] ?? "Admin"),
    "admin",
    true, // all API-key callers are considered platform admins for annotation purposes
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Annotation CRUD
// ─────────────────────────────────────────────────────────────────────────────

// GET /ai/annotations
router.get("/ai/annotations", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = AnnotationSelectionSchema.safeParse({
      ...req.query,
      limit:          req.query["limit"]          ? Number(req.query["limit"])  : undefined,
      offset:         req.query["offset"]         ? Number(req.query["offset"]) : undefined,
      includeDeleted: req.query["includeDeleted"] === "true",
    });
    if (!parsed.success) { errRes(res, 400, "Invalid query parameters"); return; }
    const ctx = adminCtx(req);
    const rows = await listAnnotations(parsed.data, ctx.tenantId);
    res.json({ data: rows, total: rows.length });
  } catch (err) { handleError(res, err); }
});

// POST /ai/annotations
router.post("/ai/annotations", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = CreateAnnotationSchema.safeParse(req.body);
    if (!parsed.success) { errRes(res, 400, "Invalid annotation input"); return; }
    const ctx = adminCtx(req);
    const annotation = await createAnnotation(parsed.data, ctx);
    res.status(201).json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

// GET /ai/annotations/:id
router.get("/ai/annotations/:id", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id");
    if (!id) { errRes(res, 400, "Invalid annotation id"); return; }
    const ctx = adminCtx(req);
    const annotation = await getAnnotation(id, ctx.tenantId);
    if (!annotation) { errRes(res, 404, "Annotation not found"); return; }
    res.json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

// PATCH /ai/annotations/:id
router.patch("/ai/annotations/:id", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id");
    if (!id) { errRes(res, 400, "Invalid annotation id"); return; }
    const parsed = UpdateAnnotationSchema.safeParse(req.body);
    if (!parsed.success) { errRes(res, 400, "Invalid update input"); return; }
    const ctx = adminCtx(req);
    const annotation = await updateAnnotation(id, parsed.data, ctx);
    res.json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

// DELETE /ai/annotations/:id
router.delete("/ai/annotations/:id", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id");
    if (!id) { errRes(res, 400, "Invalid annotation id"); return; }
    const ctx = adminCtx(req);
    await softDeleteAnnotation(id, ctx);
    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Status transitions
// ─────────────────────────────────────────────────────────────────────────────

router.post("/ai/annotations/:id/resolve", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const annotation = await resolveAnnotation(id, adminCtx(req));
    res.json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

router.post("/ai/annotations/:id/reopen", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const annotation = await reopenAnnotation(id, adminCtx(req));
    res.json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

router.post("/ai/annotations/:id/acknowledge", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const annotation = await acknowledgeAnnotation(id, adminCtx(req));
    res.json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

router.post("/ai/annotations/:id/archive", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const annotation = await archiveAnnotation(id, adminCtx(req));
    res.json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Comment thread
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/annotations/:id/comments", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const ctx = adminCtx(req);
    // Verify annotation exists and belongs to tenant before returning thread
    const ann = await getAnnotation(id, ctx.tenantId);
    if (!ann) { errRes(res, 404, "Annotation not found"); return; }
    const comments = await getThread(id);
    res.json({ data: comments });
  } catch (err) { handleError(res, err); }
});

router.post("/ai/annotations/:id/comments", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const parsed = CreateCommentSchema.safeParse(req.body);
    if (!parsed.success) { errRes(res, 400, "Invalid comment input"); return; }
    const ctx = adminCtx(req);
    const ann = await getAnnotation(id, ctx.tenantId);
    if (!ann) { errRes(res, 404, "Annotation not found"); return; }
    const comment = await addComment(id, parsed.data, ctx);
    res.status(201).json({ data: comment });
  } catch (err) { handleError(res, err); }
});

router.patch("/ai/annotations/:id/comments/:cid", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const cid = intParam(req, "cid"); if (!cid) { errRes(res, 400, "Invalid comment id"); return; }
    const parsed = EditCommentSchema.safeParse(req.body);
    if (!parsed.success) { errRes(res, 400, "Invalid edit input"); return; }
    const comment = await editComment(cid, parsed.data, adminCtx(req));
    res.json({ data: comment });
  } catch (err) { handleError(res, err); }
});

router.delete("/ai/annotations/:id/comments/:cid", adminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const cid = intParam(req, "cid"); if (!cid) { errRes(res, 400, "Invalid comment id"); return; }
    await deleteComment(cid, adminCtx(req));
    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public: token-based client review annotations
// Registered as /public/... which is on the adminAuthWithExceptions list
// ─────────────────────────────────────────────────────────────────────────────

async function resolveClientCtx(
  token: string | string[],
  req: Request,
): Promise<AnnotationActorContext | null> {
  const result = await resolveWorkspaceSession(String(token));
  if (!result.ok || !result.session) return null;
  const session = result.session as { emailHash?: string; clientEmail?: string; clientName?: string };
  return buildActorContext(
    DEFAULT_TENANT_ID,
    session.emailHash ?? session.clientEmail ?? "client",
    session.clientName ?? session.clientEmail ?? "Client",
    "client",
    false,
  );
}

// GET /public/review-annotations/:token
router.get("/public/review-annotations/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await resolveClientCtx(req.params["token"] ?? "", req);
    if (!ctx) { errRes(res, 401, "Invalid or expired review token"); return; }
    const parsed = AnnotationSelectionSchema.safeParse({
      ...req.query,
      limit:  req.query["limit"]  ? Number(req.query["limit"])  : undefined,
      offset: req.query["offset"] ? Number(req.query["offset"]) : undefined,
    });
    if (!parsed.success) { errRes(res, 400, "Invalid query"); return; }
    const rows = await listAnnotations(parsed.data, ctx.tenantId);
    res.json({ data: rows });
  } catch (err) { handleError(res, err); }
});

// POST /public/review-annotations/:token
router.post("/public/review-annotations/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await resolveClientCtx(req.params["token"] ?? "", req);
    if (!ctx) { errRes(res, 401, "Invalid or expired review token"); return; }
    const parsed = CreateAnnotationSchema.safeParse(req.body);
    if (!parsed.success) { errRes(res, 400, "Invalid annotation input"); return; }
    const annotation = await createAnnotation(parsed.data, ctx);
    res.status(201).json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

// GET /public/review-annotations/:token/:id
router.get("/public/review-annotations/:token/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await resolveClientCtx(req.params["token"] ?? "", req);
    if (!ctx) { errRes(res, 401, "Invalid or expired review token"); return; }
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const annotation = await getAnnotation(id, ctx.tenantId);
    if (!annotation) { errRes(res, 404, "Annotation not found"); return; }
    res.json({ data: annotation });
  } catch (err) { handleError(res, err); }
});

// POST /public/review-annotations/:token/:id/comments
router.post("/public/review-annotations/:token/:id/comments", async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = await resolveClientCtx(req.params["token"] ?? "", req);
    if (!ctx) { errRes(res, 401, "Invalid or expired review token"); return; }
    const id = intParam(req, "id"); if (!id) { errRes(res, 400, "Invalid id"); return; }
    const parsed = CreateCommentSchema.safeParse(req.body);
    if (!parsed.success) { errRes(res, 400, "Invalid comment input"); return; }
    const ann = await getAnnotation(id, ctx.tenantId);
    if (!ann) { errRes(res, 404, "Annotation not found"); return; }
    const comment = await addComment(id, parsed.data, ctx);
    res.status(201).json({ data: comment });
  } catch (err) { handleError(res, err); }
});

export { router as annotationRouter };
