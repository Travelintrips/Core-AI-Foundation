/**
 * Team 17 — Interior Design Planning — Route handlers
 *
 * Admin routes (x-admin-api-key):
 *   GET    /api/ai/interior-design/projects          list all projects
 *   GET    /api/ai/interior-design/projects/:id      get project + brief + latest output
 *   POST   /api/ai/interior-design/projects/:id/generate   trigger AI generation
 *   PATCH  /api/ai/interior-design/projects/:id      update project (status, notes, etc.)
 *
 * Public routes (no admin auth — under /public prefix):
 *   POST   /api/public/interior-design/projects      create project + submit brief
 *   GET    /api/public/interior-design/projects/:id/outputs   view outputs (concept only)
 */
import { Router } from "express";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  submitBrief,
  getBriefByProject,
  generateOutputs,
  getLatestOutput,
  listOutputs,
} from "./service.js";

const router = Router();

// ── Public: create project + submit brief ────────────────────────────────────

router.post("/public/interior-design/projects", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;

    if (!body["title"] || typeof body["title"] !== "string") {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!body["roomType"] || typeof body["roomType"] !== "string") {
      res.status(400).json({ error: "roomType is required" });
      return;
    }

    const project = await createProject({
      title: body["title"],
      roomType: body["roomType"],
      clientName: typeof body["clientName"] === "string" ? body["clientName"] : undefined,
      clientEmail: typeof body["clientEmail"] === "string" ? body["clientEmail"] : undefined,
      notes: typeof body["notes"] === "string" ? body["notes"] : undefined,
    });

    // Optionally submit brief in the same request
    if (body["brief"] && typeof body["brief"] === "object") {
      const b = body["brief"] as Record<string, unknown>;
      if (
        typeof b["roomLengthM"] === "number" &&
        typeof b["roomWidthM"] === "number" &&
        typeof b["ceilingHeightM"] === "number" &&
        typeof b["style"] === "string"
      ) {
        const brief = await submitBrief({
          projectId: project!.id,
          roomLengthM: b["roomLengthM"],
          roomWidthM: b["roomWidthM"],
          ceilingHeightM: b["ceilingHeightM"],
          doors: Array.isArray(b["doors"]) ? b["doors"] as never[] : undefined,
          windows: Array.isArray(b["windows"]) ? b["windows"] as never[] : undefined,
          columns: Array.isArray(b["columns"]) ? b["columns"] as never[] : undefined,
          immutableZones: Array.isArray(b["immutableZones"]) ? b["immutableZones"] as never[] : undefined,
          style: b["style"],
          primaryColors: Array.isArray(b["primaryColors"]) ? b["primaryColors"] as string[] : undefined,
          secondaryColors: Array.isArray(b["secondaryColors"]) ? b["secondaryColors"] as string[] : undefined,
          materialsPreference: typeof b["materialsPreference"] === "object" ? b["materialsPreference"] as object : undefined,
          lightingPreference: typeof b["lightingPreference"] === "object" ? b["lightingPreference"] as object : undefined,
          furnitureNeeds: Array.isArray(b["furnitureNeeds"]) ? b["furnitureNeeds"] as string[] : undefined,
          budgetNotes: typeof b["budgetNotes"] === "string" ? b["budgetNotes"] : undefined,
          photoUrls: Array.isArray(b["photoUrls"]) ? b["photoUrls"] as string[] : undefined,
          floorPlanUrl: typeof b["floorPlanUrl"] === "string" ? b["floorPlanUrl"] : undefined,
          additionalNotes: typeof b["additionalNotes"] === "string" ? b["additionalNotes"] : undefined,
        });
        res.status(201).json({ project, brief });
        return;
      }
    }

    res.status(201).json({ project });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Public: submit / update brief for an existing project ────────────────────

router.post("/public/interior-design/projects/:id/brief", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const project = await getProject(id);
    if (!project) { res.status(404).json({ error: "project not found" }); return; }

    const b = req.body as Record<string, unknown>;
    if (typeof b["roomLengthM"] !== "number" || typeof b["roomWidthM"] !== "number" ||
        typeof b["ceilingHeightM"] !== "number" || typeof b["style"] !== "string") {
      res.status(400).json({ error: "roomLengthM, roomWidthM, ceilingHeightM, style are required" });
      return;
    }

    const brief = await submitBrief({
      projectId: id,
      roomLengthM: b["roomLengthM"],
      roomWidthM: b["roomWidthM"],
      ceilingHeightM: b["ceilingHeightM"],
      doors: Array.isArray(b["doors"]) ? b["doors"] as never[] : undefined,
      windows: Array.isArray(b["windows"]) ? b["windows"] as never[] : undefined,
      columns: Array.isArray(b["columns"]) ? b["columns"] as never[] : undefined,
      immutableZones: Array.isArray(b["immutableZones"]) ? b["immutableZones"] as never[] : undefined,
      style: b["style"],
      primaryColors: Array.isArray(b["primaryColors"]) ? b["primaryColors"] as string[] : undefined,
      secondaryColors: Array.isArray(b["secondaryColors"]) ? b["secondaryColors"] as string[] : undefined,
      materialsPreference: typeof b["materialsPreference"] === "object" ? b["materialsPreference"] as object : undefined,
      lightingPreference: typeof b["lightingPreference"] === "object" ? b["lightingPreference"] as object : undefined,
      furnitureNeeds: Array.isArray(b["furnitureNeeds"]) ? b["furnitureNeeds"] as string[] : undefined,
      budgetNotes: typeof b["budgetNotes"] === "string" ? b["budgetNotes"] : undefined,
      photoUrls: Array.isArray(b["photoUrls"]) ? b["photoUrls"] as string[] : undefined,
      floorPlanUrl: typeof b["floorPlanUrl"] === "string" ? b["floorPlanUrl"] : undefined,
      additionalNotes: typeof b["additionalNotes"] === "string" ? b["additionalNotes"] : undefined,
    });

    res.json({ brief });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Public: view outputs ─────────────────────────────────────────────────────

router.get("/public/interior-design/projects/:id/outputs", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const project = await getProject(id);
    if (!project) { res.status(404).json({ error: "not found" }); return; }

    const [brief, output] = await Promise.all([
      getBriefByProject(id),
      getLatestOutput(id),
    ]);

    res.json({ project, brief, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Admin: list all projects ─────────────────────────────────────────────────

router.get("/ai/interior-design/projects", async (req, res): Promise<void> => {
  try {
    const { status, roomType, page, pageSize } = req.query as Record<string, string>;
    const result = await listProjects({
      status,
      roomType,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 100) : 20,
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Admin: get project with brief + output ───────────────────────────────────

router.get("/ai/interior-design/projects/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const [project, brief, output, allOutputs] = await Promise.all([
      getProject(id),
      getBriefByProject(id),
      getLatestOutput(id),
      listOutputs(id),
    ]);

    if (!project) { res.status(404).json({ error: "not found" }); return; }

    res.json({ project, brief, output, outputCount: allOutputs.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Admin: update project ─────────────────────────────────────────────────────

router.patch("/ai/interior-design/projects/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const updated = await updateProject(id, req.body as never);
    if (!updated) { res.status(404).json({ error: "not found" }); return; }

    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Admin: trigger AI generation ─────────────────────────────────────────────

router.post("/ai/interior-design/projects/:id/generate", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const project = await getProject(id);
    if (!project) { res.status(404).json({ error: "not found" }); return; }

    const brief = await getBriefByProject(id);
    if (!brief) {
      res.status(422).json({ error: "No brief found for this project. Submit a brief first." });
      return;
    }

    if (["completed"].includes(project.status)) {
      res.status(409).json({ error: `Project is ${project.status}. Create a new project to regenerate.` });
      return;
    }

    const result = await generateOutputs(id);

    res.json({
      output: result.output,
      validationResult: result.validationResult,
      safetyDisclaimers: result.safetyDisclaimers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Admin: list all outputs for a project ────────────────────────────────────

router.get("/ai/interior-design/projects/:id/outputs", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const outputs = await listOutputs(id);
    res.json({ items: outputs, total: outputs.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

export default router;
