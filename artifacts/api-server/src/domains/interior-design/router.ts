/**
 * Team 17 — Interior Design Planning — Route handlers
 *
 * SECURITY / IDOR:
 *   Public routes identify a project by accessToken (possession = ownership).
 *   Numeric projectId is NEVER accepted from public request body/query.
 *   Admin routes are protected by the global adminAuth middleware (app-level).
 *
 * Public routes (under /public prefix — skip admin key, require access token):
 *   POST  /public/interior-design/projects               create project; returns accessToken
 *   POST  /public/interior-design/projects/:token/brief  submit brief (token = accessToken)
 *   GET   /public/interior-design/projects/:token/outputs view outputs
 *
 * Admin routes (global adminAuth applies):
 *   GET   /ai/interior-design/projects
 *   GET   /ai/interior-design/projects/:id
 *   PATCH /ai/interior-design/projects/:id
 *   POST  /ai/interior-design/projects/:id/generate
 *   GET   /ai/interior-design/projects/:id/outputs
 */
import { Router } from "express";
import {
  createProject,
  listProjects,
  getProject,
  getProjectByToken,
  updateProject,
  submitBrief,
  getBriefByProject,
  generateOutputs,
  getLatestOutput,
  listOutputs,
} from "./service.js";

const router = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

/** Strip accessToken from project before sending to customer */
function publicProject(p: Record<string, unknown>) {
  const { accessToken: _tok, ...safe } = p;
  return safe;
}

// ── Public: create project (returns accessToken once — store it) ──────────────

router.post("/public/interior-design/projects", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;

    if (!body["title"] || typeof body["title"] !== "string") {
      res.status(400).json({ error: "title is required" }); return;
    }
    if (!body["roomType"] || typeof body["roomType"] !== "string") {
      res.status(400).json({ error: "roomType is required" }); return;
    }

    const project = await createProject({
      title: body["title"],
      roomType: body["roomType"],
      clientName:  typeof body["clientName"]  === "string" ? body["clientName"]  : undefined,
      clientEmail: typeof body["clientEmail"] === "string" ? body["clientEmail"] : undefined,
      notes:       typeof body["notes"]       === "string" ? body["notes"]       : undefined,
    });

    if (!project) { res.status(500).json({ error: "failed to create project" }); return; }

    // Optionally submit brief in the same request
    if (body["brief"] && typeof body["brief"] === "object") {
      const b = body["brief"] as Record<string, unknown>;
      if (
        typeof b["roomLengthM"]    === "number" &&
        typeof b["roomWidthM"]     === "number" &&
        typeof b["ceilingHeightM"] === "number" &&
        typeof b["style"]          === "string"
      ) {
        const brief = await submitBrief({
          projectId: project.id,
          roomType: project.roomType,
          roomLengthM:   b["roomLengthM"],
          roomWidthM:    b["roomWidthM"],
          ceilingHeightM: b["ceilingHeightM"],
          doors:          Array.isArray(b["doors"])          ? b["doors"] as never[]       : undefined,
          windows:        Array.isArray(b["windows"])        ? b["windows"] as never[]     : undefined,
          columns:        Array.isArray(b["columns"])        ? b["columns"] as never[]     : undefined,
          immutableZones: Array.isArray(b["immutableZones"]) ? b["immutableZones"] as never[] : undefined,
          style:          b["style"],
          primaryColors:   Array.isArray(b["primaryColors"])   ? b["primaryColors"] as string[]   : undefined,
          secondaryColors: Array.isArray(b["secondaryColors"]) ? b["secondaryColors"] as string[] : undefined,
          materialsPreference: typeof b["materialsPreference"] === "object" ? b["materialsPreference"] as object : undefined,
          lightingPreference:  typeof b["lightingPreference"]  === "object" ? b["lightingPreference"]  as object : undefined,
          furnitureNeeds: Array.isArray(b["furnitureNeeds"]) ? b["furnitureNeeds"] as string[] : undefined,
          budgetNotes:   typeof b["budgetNotes"]   === "string" ? b["budgetNotes"]   : undefined,
          photoUrls:     Array.isArray(b["photoUrls"])     ? b["photoUrls"] as string[]     : undefined,
          floorPlanUrl:  typeof b["floorPlanUrl"]  === "string" ? b["floorPlanUrl"]  : undefined,
          additionalNotes: typeof b["additionalNotes"] === "string" ? b["additionalNotes"] : undefined,
        });

        // Auto-trigger AI generation in background — client polls for status changes.
        // generateOutputs() immediately sets status → "analyzing", then → "outputs_ready".
        const clientId = typeof body["clientEmail"] === "string" ? body["clientEmail"] : undefined;
        void generateOutputs(project.id, { clientId }).catch((genErr) => {
          console.error("[interior-design] Auto-generation failed:", genErr instanceof Error ? genErr.message : genErr);
        });

        // accessToken returned once at creation — customer must store it
        res.status(201).json({ project: publicProject(project as never), brief, accessToken: project.accessToken });
        return;
      }
    }

    res.status(201).json({ project: publicProject(project as never), accessToken: project.accessToken });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Public: submit / update brief (:token = accessToken) ─────────────────────

router.post("/public/interior-design/projects/:token/brief", async (req, res): Promise<void> => {
  try {
    const token = req.params["token"] ?? "";
    // IDOR: ownership verified by token — derive project from token, not from body
    const project = await getProjectByToken(token);
    if (!project) { res.status(404).json({ error: "not found" }); return; }

    const b = req.body as Record<string, unknown>;
    if (
      typeof b["roomLengthM"] !== "number" || typeof b["roomWidthM"] !== "number" ||
      typeof b["ceilingHeightM"] !== "number" || typeof b["style"] !== "string"
    ) {
      res.status(400).json({ error: "roomLengthM, roomWidthM, ceilingHeightM, style are required" }); return;
    }

    const brief = await submitBrief({
      projectId: project.id,          // derived from token, not request
      roomType:  project.roomType,
      roomLengthM:   b["roomLengthM"],
      roomWidthM:    b["roomWidthM"],
      ceilingHeightM: b["ceilingHeightM"],
      doors:          Array.isArray(b["doors"])          ? b["doors"] as never[]       : undefined,
      windows:        Array.isArray(b["windows"])        ? b["windows"] as never[]     : undefined,
      columns:        Array.isArray(b["columns"])        ? b["columns"] as never[]     : undefined,
      immutableZones: Array.isArray(b["immutableZones"]) ? b["immutableZones"] as never[] : undefined,
      style:          b["style"],
      primaryColors:   Array.isArray(b["primaryColors"])   ? b["primaryColors"] as string[]   : undefined,
      secondaryColors: Array.isArray(b["secondaryColors"]) ? b["secondaryColors"] as string[] : undefined,
      materialsPreference: typeof b["materialsPreference"] === "object" ? b["materialsPreference"] as object : undefined,
      lightingPreference:  typeof b["lightingPreference"]  === "object" ? b["lightingPreference"]  as object : undefined,
      furnitureNeeds: Array.isArray(b["furnitureNeeds"]) ? b["furnitureNeeds"] as string[] : undefined,
      budgetNotes:   typeof b["budgetNotes"]   === "string" ? b["budgetNotes"]   : undefined,
      photoUrls:     Array.isArray(b["photoUrls"])     ? b["photoUrls"] as string[]     : undefined,
      floorPlanUrl:  typeof b["floorPlanUrl"]  === "string" ? b["floorPlanUrl"]  : undefined,
      additionalNotes: typeof b["additionalNotes"] === "string" ? b["additionalNotes"] : undefined,
    });

    res.json({ brief });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Public: view outputs (:token = accessToken) ──────────────────────────────

router.get("/public/interior-design/projects/:token/outputs", async (req, res): Promise<void> => {
  try {
    const token = req.params["token"] ?? "";
    // IDOR: ownership verified by token
    const project = await getProjectByToken(token);
    if (!project) { res.status(404).json({ error: "not found" }); return; }

    const [brief, output] = await Promise.all([
      getBriefByProject(project.id),
      getLatestOutput(project.id),
    ]);

    res.json({ project: publicProject(project as never), brief, output });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Admin: list all projects ──────────────────────────────────────────────────

router.get("/ai/interior-design/projects", async (req, res): Promise<void> => {
  try {
    const { status, roomType, page, pageSize } = req.query as Record<string, string>;
    const result = await listProjects({
      status,
      roomType,
      page:     page     ? parseInt(page, 10)     : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 100) : 20,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Admin: get project with brief + output ───────────────────────────────────

router.get("/ai/interior-design/projects/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const [project, brief, output, allOutputs] = await Promise.all([
      getProject(id), getBriefByProject(id), getLatestOutput(id), listOutputs(id),
    ]);
    if (!project) { res.status(404).json({ error: "not found" }); return; }

    res.json({ project, brief, output, outputCount: allOutputs.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
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
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
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
      res.status(422).json({ error: "No brief found. Submit a brief first." }); return;
    }
    if (project.status === "completed") {
      res.status(409).json({ error: "Project is completed. Create a new project to regenerate." }); return;
    }

    // Optional: admin can supply a clientId to enrich output from Brand Intelligence V2
    const body = req.body as Record<string, unknown>;
    const clientId = typeof body["clientId"] === "string" ? body["clientId"] : undefined;

    const result = await generateOutputs(id, { clientId });
    res.json({ output: result.output, validationResult: result.validationResult, safetyDisclaimers: result.safetyDisclaimers });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Admin: list all outputs for a project ────────────────────────────────────

router.get("/ai/interior-design/projects/:id/outputs", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    const project = await getProject(id);
    if (!project) { res.status(404).json({ error: "not found" }); return; }

    const outputs = await listOutputs(id);
    res.json({ items: outputs, total: outputs.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
