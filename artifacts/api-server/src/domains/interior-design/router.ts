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
  getOrInitializeDraftByProjectUuid,
  updateConceptDraft,
  updateDraftReviewState,
  resetDraftToOriginal,
  requestRevision,
} from "./service.js";
import {
  getImagesByProject,
  deleteImage,
  adminUploadImage,
  enrichItem,
  type EnrichItemInput,
} from "./interiorImageService.js";
import {
  getInteriorRenderStatus,
  retryInteriorRender,
  startInteriorRender,
} from "../../services/interiorRenderService.js";
import { resolveAuthenticatedTenantContext } from "../../security/tenantResolution.js";
import {
  moodboardGenerateRequestSchema,
  moodboardProjectUuidSchema,
} from "./moodboardSchemas.js";
import { generateMoodboard, getMoodboard } from "./moodboardService.js";

const router = Router();

function structuredError(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

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

// ── Admin: deterministic Moodboard Generator (WP-08) ────────────────────────
//
// The project UUID is resolved against creative_projects server-side. The
// tenant context is also resolved from the authenticated request; no tenant
// identifier from body/query/header is accepted.
router.post("/ai/interior-design/projects/:projectUuid/moodboard/generate", async (req, res): Promise<void> => {
  try {
    const projectUuid = req.params["projectUuid"] ?? "";
    if (!moodboardProjectUuidSchema.safeParse(projectUuid).success) {
      res.status(400).json(structuredError("INVALID_PROJECT_UUID", "projectUuid must be a valid UUID")); return;
    }
    const body = moodboardGenerateRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json(structuredError("INVALID_REQUEST", "Invalid moodboard generation request", body.error.flatten())); return;
    }
    resolveAuthenticatedTenantContext(req);
    const result = await generateMoodboard(projectUuid, { force: body.data.force });
    res.status(result.reused ? 200 : 201).json({ moodboard: result.moodboard, available: true, reused: result.reused });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as { code?: string }).code ?? "MOODBOARD_GENERATION_FAILED";
    res.status(status).json(structuredError(code, err instanceof Error ? err.message : "Moodboard generation failed"));
  }
});

router.get("/ai/interior-design/projects/:projectUuid/moodboard", async (req, res): Promise<void> => {
  try {
    const projectUuid = req.params["projectUuid"] ?? "";
    if (!moodboardProjectUuidSchema.safeParse(projectUuid).success) {
      res.status(400).json(structuredError("INVALID_PROJECT_UUID", "projectUuid must be a valid UUID")); return;
    }
    resolveAuthenticatedTenantContext(req);
    const moodboard = await getMoodboard(projectUuid);
    res.json({ moodboard, available: Boolean(moodboard) });
  } catch (err) {
    res.status(500).json(structuredError("MOODBOARD_READ_FAILED", err instanceof Error ? err.message : "Moodboard read failed"));
  }
});

// ── Admin: Concept Draft CRUD ─────────────────────────────────────────────────
//
// Drafts are keyed by creative_projects.project_id (UUID text).
// Admin edits space plan, materials, furniture, lighting, and visual concept.
// Original AI output is preserved separately and can be restored.

/**
 * GET /ai/interior-design/drafts/:projectUuid
 * Get (or lazily initialise) the concept draft for a creative project.
 * Safe to call multiple times — idempotent initialisation.
 */
router.get("/ai/interior-design/drafts/:projectUuid", async (req, res): Promise<void> => {
  try {
    const projectUuid = req.params["projectUuid"] ?? "";
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }

    const draft = await getOrInitializeDraftByProjectUuid(projectUuid);
    if (!draft) { res.status(404).json({ error: "Creative project not found or has no Interior Design steps yet" }); return; }

    res.json({ draft });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * PATCH /ai/interior-design/drafts/:projectUuid
 * Update one or more sections of the editable draft.
 * Supports optimistic concurrency via optional X-Expected-Updated-At header or body.updatedAt.
 *
 * Body: { spacePlan?, materials?, furniture?, lighting?, visualConcept?, updatedAt?, editorId? }
 */
router.patch("/ai/interior-design/drafts/:projectUuid", async (req, res): Promise<void> => {
  try {
    const projectUuid = req.params["projectUuid"] ?? "";
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }

    const body = req.body as Record<string, unknown>;
    const editorId = typeof body["editorId"] === "string" ? body["editorId"] : "admin";
    const expectedUpdatedAt = typeof body["updatedAt"] === "string" ? body["updatedAt"] : undefined;

    const sections: Record<string, unknown> = {};
    if ("spacePlan"     in body) sections["spacePlan"]     = body["spacePlan"];
    if ("materials"     in body) sections["materials"]     = body["materials"];
    if ("furniture"     in body) sections["furniture"]     = body["furniture"];
    if ("lighting"      in body) sections["lighting"]      = body["lighting"];
    if ("visualConcept" in body) sections["visualConcept"] = body["visualConcept"];

    if (Object.keys(sections).length === 0) {
      res.status(400).json({ error: "At least one section (spacePlan, materials, furniture, lighting, visualConcept) must be provided" });
      return;
    }

    const draft = await updateConceptDraft(projectUuid, sections, editorId, expectedUpdatedAt);
    res.json({ draft });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * PATCH /ai/interior-design/drafts/:projectUuid/review-state
 * Transition the draft to a new review state.
 * Body: { state: string, editorId?: string }
 */
router.patch("/ai/interior-design/drafts/:projectUuid/review-state", async (req, res): Promise<void> => {
  try {
    const projectUuid = req.params["projectUuid"] ?? "";
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }

    const body = req.body as Record<string, unknown>;
    if (!body["state"] || typeof body["state"] !== "string") {
      res.status(400).json({ error: "state is required" }); return;
    }

    const editorId = typeof body["editorId"] === "string" ? body["editorId"] : "admin";
    const draft = await updateDraftReviewState(projectUuid, body["state"], editorId);
    res.json({ draft });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /ai/interior-design/drafts/:projectUuid/request-revision
 *
 * Request revision on an approved draft.
 * This is the ONLY valid way to leave approved_for_rendering state.
 * Transitions: approved_for_rendering → revision_requested.
 *
 * Body: { requestedBy?: string, reason?: string }
 * Protected by global adminAuth middleware — unauthorized requests receive 401.
 */
router.post("/ai/interior-design/drafts/:projectUuid/request-revision", async (req, res): Promise<void> => {
  try {
    const projectUuid = req.params["projectUuid"] ?? "";
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }

    const body = req.body as Record<string, unknown>;
    const requestedBy = typeof body["requestedBy"] === "string" ? body["requestedBy"] : "admin";
    const reason      = typeof body["reason"]      === "string" ? body["reason"]      : undefined;

    const draft = await requestRevision(projectUuid, requestedBy, reason);
    res.json({ draft });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /ai/interior-design/drafts/:projectUuid/reset
 * Restore one or more sections to the original AI-generated values.
 * Body: { sections: string[], editorId?: string }
 */
router.post("/ai/interior-design/drafts/:projectUuid/reset", async (req, res): Promise<void> => {
  try {
    const projectUuid = req.params["projectUuid"] ?? "";
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }

    const body = req.body as Record<string, unknown>;
    const rawSections = Array.isArray(body["sections"]) ? body["sections"] as string[] : [];
    const validSections = ["spacePlan", "materials", "furniture", "lighting", "visualConcept"] as const;
    const sections = rawSections.filter((s): s is typeof validSections[number] =>
      (validSections as readonly string[]).includes(s),
    );
    if (sections.length === 0) {
      res.status(400).json({ error: `sections must be a non-empty array of: ${validSections.join(", ")}` }); return;
    }

    const editorId = typeof body["editorId"] === "string" ? body["editorId"] : "admin";
    const draft = await resetDraftToOriginal(projectUuid, sections, editorId);
    res.json({ draft });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── Asset Images ──────────────────────────────────────────────────────────────
//
// GET  /ai/interior-design/asset-images/:projectUuid        list all images
// POST /ai/interior-design/asset-images/:projectUuid/upload admin manual upload
// POST /ai/interior-design/asset-images/:projectUuid/enrich enrich a single item
// DELETE /ai/interior-design/asset-images/:projectUuid/:itemType/:itemId  delete

/**
 * GET /ai/interior-design/asset-images/:projectUuid
 * Returns all image records for a project as a map keyed by "{itemType}:{itemId}".
 */
router.get("/ai/interior-design/asset-images/:projectUuid", async (req, res): Promise<void> => {
  try {
    const { projectUuid } = req.params as { projectUuid: string };
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }
    const images = await getImagesByProject(projectUuid);
    const map: Record<string, unknown> = {};
    for (const img of images) {
      map[`${img.itemType}:${img.itemId}`] = img;
    }
    res.json({ images: map, total: images.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /ai/interior-design/asset-images/:projectUuid/upload
 * Admin manual image upload. Accepts base64 encoded image data.
 *
 * Body: { itemType, itemId, imageData (base64), mimeType, altText?, forceReplace? }
 */
router.post("/ai/interior-design/asset-images/:projectUuid/upload", async (req, res): Promise<void> => {
  try {
    const { projectUuid } = req.params as { projectUuid: string };
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }

    const body = req.body as Record<string, unknown>;
    const itemType     = typeof body["itemType"]      === "string" ? body["itemType"]     : null;
    const itemId       = typeof body["itemId"]        === "string" ? body["itemId"]       : null;
    const imageData    = typeof body["imageData"]     === "string" ? body["imageData"]    : null;
    const mimeType     = typeof body["mimeType"]      === "string" ? body["mimeType"]     : null;
    const altText      = typeof body["altText"]       === "string" ? body["altText"]      : undefined;
    const forceReplace = body["forceReplace"] === true;

    if (!itemType || !["material","furniture","lighting","space_plan"].includes(itemType)) {
      res.status(400).json({ error: "itemType must be one of: material, furniture, lighting, space_plan" }); return;
    }
    if (!itemId)    { res.status(400).json({ error: "itemId is required" }); return; }
    if (!imageData) { res.status(400).json({ error: "imageData (base64) is required" }); return; }
    if (!mimeType)  { res.status(400).json({ error: "mimeType is required" }); return; }

    const image = await adminUploadImage(
      projectUuid, itemType, itemId, imageData, mimeType, altText, forceReplace,
    );
    res.json({ image });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /ai/interior-design/asset-images/:projectUuid/enrich
 * Trigger Pexels enrichment for a single item.
 *
 * Body: { itemType, itemId, name?, category?, materialType?, style?, color?,
 *         zone?, lightingType?, fixtureType?, force? }
 */
router.post("/ai/interior-design/asset-images/:projectUuid/enrich", async (req, res): Promise<void> => {
  try {
    const { projectUuid } = req.params as { projectUuid: string };
    if (!projectUuid) { res.status(400).json({ error: "projectUuid is required" }); return; }

    const body = req.body as Record<string, unknown>;
    const itemType = typeof body["itemType"] === "string" ? body["itemType"] : null;
    const itemId   = typeof body["itemId"]   === "string" ? body["itemId"]   : null;
    const force    = body["force"] === true;

    if (!itemType || !["material","furniture","lighting","space_plan"].includes(itemType)) {
      res.status(400).json({ error: "itemType must be one of: material, furniture, lighting, space_plan" }); return;
    }
    if (!itemId) { res.status(400).json({ error: "itemId is required" }); return; }

    const input: EnrichItemInput = {
      projectUuid,
      itemType: itemType as EnrichItemInput["itemType"],
      itemId,
      name:         typeof body["name"]         === "string" ? body["name"]         : undefined,
      category:     typeof body["category"]     === "string" ? body["category"]     : undefined,
      materialType: typeof body["materialType"] === "string" ? body["materialType"] : undefined,
      style:        typeof body["style"]        === "string" ? body["style"]        : undefined,
      color:        typeof body["color"]        === "string" ? body["color"]        : undefined,
      zone:         typeof body["zone"]         === "string" ? body["zone"]         : undefined,
      lightingType: typeof body["lightingType"] === "string" ? body["lightingType"] : undefined,
      fixtureType:  typeof body["fixtureType"]  === "string" ? body["fixtureType"]  : undefined,
    };

    const result = await enrichItem(input, { force });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * DELETE /ai/interior-design/asset-images/:projectUuid/:itemType/:itemId
 * Delete (revert to fallback visual) an image record.
 */
router.delete("/ai/interior-design/asset-images/:projectUuid/:itemType/:itemId", async (req, res): Promise<void> => {
  try {
    const { projectUuid, itemType, itemId } = req.params as {
      projectUuid: string; itemType: string; itemId: string;
    };
    if (!projectUuid || !itemType || !itemId) {
      res.status(400).json({ error: "projectUuid, itemType, itemId are required" }); return;
    }
    const deleted = await deleteImage(projectUuid, itemType, itemId);
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ── WP-09: approved-snapshot rendering pipeline ─────────────────────────────

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function renderErrorStatus(error: unknown): number {
  const status = error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 500;
  return [400, 404, 409, 422].includes(status) ? status : 500;
}

router.post("/ai/interior-design/projects/:projectUuid/render", async (req, res): Promise<void> => {
  const projectUuid = String(req.params.projectUuid ?? "");
  if (!isUuid(projectUuid)) {
    res.status(400).json({ error: "projectUuid must be a valid UUID" });
    return;
  }
  try {
    const tenant = resolveAuthenticatedTenantContext(req);
    const rawCount = req.body?.variantCount;
    const variantCount = rawCount === undefined ? undefined : Number(rawCount);
    const result = await startInteriorRender({
      projectUuid,
      tenantId: tenant.tenantId,
      variantCount,
    });
    res.status(result.idempotent ? 200 : 202).json(result);
  } catch (error) {
    res.status(renderErrorStatus(error)).json({ error: error instanceof Error ? error.message : "Unable to start render" });
  }
});

router.get("/ai/interior-design/projects/:projectUuid/render", async (req, res): Promise<void> => {
  const projectUuid = String(req.params.projectUuid ?? "");
  if (!isUuid(projectUuid)) {
    res.status(400).json({ error: "projectUuid must be a valid UUID" });
    return;
  }
  try {
    resolveAuthenticatedTenantContext(req);
    const result = await getInteriorRenderStatus(projectUuid);
    if (!result) {
      res.status(404).json({ error: "Render session not found" });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(renderErrorStatus(error)).json({ error: error instanceof Error ? error.message : "Unable to read render" });
  }
});

router.post("/ai/interior-design/projects/:projectUuid/render/retry", async (req, res): Promise<void> => {
  const projectUuid = String(req.params.projectUuid ?? "");
  if (!isUuid(projectUuid)) {
    res.status(400).json({ error: "projectUuid must be a valid UUID" });
    return;
  }
  try {
    const tenant = resolveAuthenticatedTenantContext(req);
    const result = await retryInteriorRender({ projectUuid, tenantId: tenant.tenantId });
    res.status(result.idempotent ? 200 : 202).json(result);
  } catch (error) {
    res.status(renderErrorStatus(error)).json({ error: error instanceof Error ? error.message : "Unable to retry render" });
  }
});

export default router;
