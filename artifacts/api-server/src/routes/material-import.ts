/**
 * Phase 5 controlled material import review API.
 * All routes are mounted behind the app-level admin middleware. The additional
 * role guard below maps the platform's existing internal roles to the Phase 5
 * business roles without trusting client-supplied role fields.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/internalAuth.js";
import {
  bulkTransition,
  createStagedMaterial,
  getMaterialImportDashboard,
  getStagedMaterial,
  importApprovedMaterials,
  listStagedMaterials,
  resolveDuplicate,
  retryAsset,
  transitionStagedMaterial,
  type Actor,
  type DuplicateResolution,
  type MergeFieldMap,
  type ImportState,
  IMPORT_STATES,
} from "../services/materialImportService.js";

const router = Router();
const PHASE5_ROLES = new Set(["owner", "admin", "manager", "internal_staff"]);

function phase5Role(req: Request, res: Response, next: NextFunction): void {
  const user = req.internalUser;
  if (!user || user.status !== "active" || user.accountType !== "internal" || !PHASE5_ROLES.has(user.role)) {
    res.status(403).json({ error: "Only Super Admin, Material Manager, or Catalog Reviewer may review/import materials" });
    return;
  }
  next();
}

function actor(req: Request): Actor {
  return {
    id: req.internalUser ? String(req.internalUser.id) : "admin-api-key",
    name: req.internalUser?.email ?? "Admin API",
    type: req.internalUser ? "internal" : "system",
  };
}

function parseIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("ids must be an array");
  const ids = value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) throw new Error("At least one valid id is required");
  return ids;
}

function handle(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "Material import request failed";
  const status = /not found/i.test(message) ? 404 : /only |required|invalid|cannot |must /i.test(message) ? 400 : 500;
  res.status(status).json({ error: message });
}

router.use(requireAuth, phase5Role);

router.get("/dashboard", async (_req, res) => {
  try { res.json(await getMaterialImportDashboard()); } catch (err) { handle(res, err); }
});

router.get("/review", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" && IMPORT_STATES.includes(req.query.status as ImportState)
      ? req.query.status as ImportState : undefined;
    const sort = req.query.sort === "created_asc" || req.query.sort === "duplicate_desc" ? req.query.sort : "created_desc";
    res.json(await listStagedMaterials({
      status,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 25,
      sort,
    }));
  } catch (err) { handle(res, err); }
});

router.get("/review/:id", async (req, res) => {
  try { res.json(await getStagedMaterial(Number(req.params.id))); } catch (err) { handle(res, err); }
});

router.post("/staged", async (req, res) => {
  try { res.status(201).json({ material: await createStagedMaterial(req.body, actor(req)) }); } catch (err) { handle(res, err); }
});

router.patch("/review/:id/status", async (req, res) => {
  try {
    const status = req.body?.status as ImportState;
    if (!IMPORT_STATES.includes(status)) throw new Error("Invalid status");
    res.json({ material: await transitionStagedMaterial(Number(req.params.id), status, actor(req), req.body?.notes) });
  } catch (err) { handle(res, err); }
});

router.post("/review/bulk", async (req, res) => {
  try {
    const status = req.body?.status as "approved" | "rejected" | "needs_review";
    if (!["approved", "rejected", "needs_review"].includes(status)) throw new Error("Bulk status must be approved, rejected, or needs_review");
    res.json(await bulkTransition(parseIds(req.body?.ids), status, actor(req), req.body?.notes));
  } catch (err) { handle(res, err); }
});

router.post("/duplicates/:id/resolve", async (req, res) => {
  try {
    const resolution = req.body?.resolution as DuplicateResolution;
    const options: { targetCanonicalId?: number; mergeFieldMap?: MergeFieldMap } = {};
    if (req.body?.targetCanonicalId != null) options.targetCanonicalId = Number(req.body.targetCanonicalId);
    if (req.body?.mergeFieldMap != null) options.mergeFieldMap = req.body.mergeFieldMap as MergeFieldMap;
    res.json(await resolveDuplicate(Number(req.params.id), resolution, actor(req), req.body?.notes, options));
  } catch (err) { handle(res, err); }
});

router.post("/import", async (req, res) => {
  try {
    const ids = req.body?.ids === "all" ? "all" : parseIds(req.body?.ids);
    res.json(await importApprovedMaterials(ids, actor(req)));
  } catch (err) { handle(res, err); }
});

router.post("/review/:id/retry-asset", async (req, res) => {
  try { res.json(await retryAsset(Number(req.params.id), actor(req))); } catch (err) { handle(res, err); }
});

export default router;