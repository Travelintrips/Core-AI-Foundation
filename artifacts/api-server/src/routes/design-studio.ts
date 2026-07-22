/**
 * V4.5 AI Design Studio — admin routes
 * All routes protected by adminAuth middleware (applied globally via app.ts).
 */
import { Router } from "express";
import {
  listDesignProjects,
  getDesignProject,
  createDesignProject,
  updateDesignProject,
  archiveDesignProject,
  getDesignCanvas,
  saveDesignCanvas,
  listDesignVersions,
  getDesignVersion,
  restoreDesignVersion,
  exportDesign,
  aiRegenerateElement,
  type ListVersionsOptions,
} from "../services/designStudioService.js";
import {
  listBuiltinTemplates,
  getBuiltinTemplate,
} from "../data/design-templates.js";

const router = Router();

// ── Projects ──────────────────────────────────────────────────────────────────

/** GET /api/ai/design/projects */
router.get("/ai/design/projects", async (req, res) => {
  try {
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const page = parseInt(String(req.query["page"] ?? "1"), 10);
    const pageSize = Math.min(parseInt(String(req.query["pageSize"] ?? "20"), 10), 100);
    const result = await listDesignProjects({ status, page, pageSize });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** POST /api/ai/design/projects */
router.post("/ai/design/projects", async (req, res) => {
  try {
    const project = await createDesignProject(req.body);
    res.status(201).json(project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** GET /api/ai/design/projects/:id */
router.get("/ai/design/projects/:id", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const project = await getDesignProject(id);
    if (!project) { res.status(404).json({ error: "Not found" }); return; }
    res.json(project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** PATCH /api/ai/design/projects/:id */
router.patch("/ai/design/projects/:id", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const updated = await updateDesignProject(id, req.body);
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** POST /api/ai/design/projects/:id/archive */
router.post("/ai/design/projects/:id/archive", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await archiveDesignProject(id);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Canvas ─────────────────────────────────────────────────────────────────────

/** GET /api/ai/design/projects/:id/canvas */
router.get("/ai/design/projects/:id/canvas", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const canvas = await getDesignCanvas(id);
    if (!canvas) { res.status(404).json({ error: "Not found" }); return; }
    res.json(canvas);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** PUT /api/ai/design/projects/:id/canvas */
router.put("/ai/design/projects/:id/canvas", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { canvasState, label } = req.body;
    if (!canvasState) { res.status(400).json({ error: "canvasState required" }); return; }
    const result = await saveDesignCanvas(id, canvasState, label);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Versions ──────────────────────────────────────────────────────────────────

/** GET /api/ai/design/projects/:id/versions?page=1&pageSize=30 */
router.get("/ai/design/projects/:id/versions", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const opts: ListVersionsOptions = {
      page: Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10)),
      pageSize: Math.min(100, Math.max(1, parseInt(String(req.query["pageSize"] ?? "30"), 10))),
    };
    const result = await listDesignVersions(id, opts);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** GET /api/ai/design/projects/:id/versions/:versionId */
router.get("/ai/design/projects/:id/versions/:versionId", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    const versionId = parseInt(req.params["versionId"] ?? "", 10);
    if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const version = await getDesignVersion(id, versionId);
    if (!version) { res.status(404).json({ error: "Not found" }); return; }
    res.json(version);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** POST /api/ai/design/projects/:id/versions/:versionId/restore */
router.post("/ai/design/projects/:id/versions/:versionId/restore", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    const versionId = parseInt(req.params["versionId"] ?? "", 10);
    if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await restoreDesignVersion(id, versionId);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

/** POST /api/ai/design/projects/:id/export */
router.post("/ai/design/projects/:id/export", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { format = "json", scale = 1 } = req.body;
    const result = await exportDesign(id, format, scale);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Built-in Templates ────────────────────────────────────────────────────────

/** GET /api/ai/design/templates/builtin — daftar template bawaan (no DB) */
router.get("/ai/design/templates/builtin", (req, res) => {
  const category = typeof req.query["category"] === "string" ? req.query["category"] : undefined;
  const industry = typeof req.query["industry"] === "string" ? req.query["industry"] : undefined;
  const style    = typeof req.query["style"]    === "string" ? req.query["style"]    : undefined;
  const templates = listBuiltinTemplates({ category, industry, style });
  // Strip canvasState from list view to keep payload small
  const items = templates.map(({ canvasState: _cs, ...meta }) => meta);
  res.json({ items, total: items.length });
});

/** GET /api/ai/design/templates/builtin/:code — detail + canvas state lengkap */
router.get("/ai/design/templates/builtin/:code", (req, res) => {
  const tpl = getBuiltinTemplate(req.params["code"] ?? "");
  if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(tpl);
});

// ── AI Regenerate ─────────────────────────────────────────────────────────────

/** POST /api/ai/design/projects/:id/ai/regenerate */
router.post("/ai/design/projects/:id/ai/regenerate", async (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await aiRegenerateElement(id, req.body);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

export default router;
