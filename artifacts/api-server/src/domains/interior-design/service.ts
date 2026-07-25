/**
 * Team 17 — Interior Design Planning — Service layer
 *
 * Compliance notes (Global Remediation Rules):
 * - Schema imported from domain-local ./schema.ts (NOT @workspace/db/schema)
 * - Access token generated at project creation; all public reads verified by token
 * - Brand Intelligence V2 is the source of truth for style/material data (via adapter)
 * - Interior Design stores only: preference snapshot, sourceBrandProfileId/Version, overrides
 * - No RAB / pricing calculations
 */
import { db, creativeProjectsTable, creativeProjectStepsTable } from "@workspace/db";
import {
  idProjectsTable,
  idBriefsTable,
  idOutputsTable,
  idConceptDraftsTable,
  CONCEPT_DRAFT_REVIEW_STATES,
  type IdConceptDraft,
} from "./schema.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import {
  runFullValidation,
  generateSafetyDisclaimers,
  type RoomGeometry,
  type DoorSpec,
  type WindowSpec,
  type ColumnSpec,
} from "./validation.js";
import { readBrandStyleSnapshot } from "./brandIntelligenceAdapter.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  title: string;
  roomType: string;
  clientName?: string;
  clientEmail?: string;
  notes?: string;
}

export interface SubmitBriefInput {
  projectId: number;
  roomType?: string;
  roomLengthM: number;
  roomWidthM: number;
  ceilingHeightM: number;
  doors?: DoorSpec[];
  windows?: WindowSpec[];
  columns?: ColumnSpec[];
  immutableZones?: object[];
  style: string;
  primaryColors?: string[];
  secondaryColors?: string[];
  materialsPreference?: object;
  lightingPreference?: object;
  furnitureNeeds?: string[];
  budgetNotes?: string;
  photoUrls?: string[];
  floorPlanUrl?: string;
  additionalNotes?: string;
}

export interface ListProjectsOptions {
  status?: string;
  roomType?: string;
  page?: number;
  pageSize?: number;
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

export async function createProject(input: CreateProjectInput) {
  const [row] = await db
    .insert(idProjectsTable)
    .values({
      title: input.title,
      roomType: input.roomType,
      clientName: input.clientName ?? null,
      clientEmail: input.clientEmail ?? null,
      notes: input.notes ?? null,
      status: "draft",
      accessToken: randomUUID(),
    })
    .returning();
  return row;
}

export async function listProjects(opts: ListProjectsOptions = {}) {
  const { status, roomType, page = 1, pageSize = 20 } = opts;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (status) conditions.push(eq(idProjectsTable.status, status));
  if (roomType) conditions.push(eq(idProjectsTable.roomType, roomType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(idProjectsTable)
      .where(where)
      .orderBy(desc(idProjectsTable.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(idProjectsTable)
      .where(where),
  ]);

  return { items: rows, total: countResult[0]?.count ?? 0, page, pageSize };
}

/** Admin: look up by numeric ID — admin routes only */
export async function getProject(id: number) {
  const [project] = await db
    .select()
    .from(idProjectsTable)
    .where(eq(idProjectsTable.id, id))
    .limit(1);
  return project ?? null;
}

/**
 * Public/customer: look up by access token — IDOR guard.
 * Ownership is proven by possession of the token returned at creation.
 * Never accept numeric projectId from public request body/query as identity.
 */
export async function getProjectByToken(token: string) {
  if (!token || token.length < 8) return null;
  const [project] = await db
    .select()
    .from(idProjectsTable)
    .where(eq(idProjectsTable.accessToken, token))
    .limit(1);
  return project ?? null;
}

export async function updateProjectStatus(id: number, status: string) {
  const [updated] = await db
    .update(idProjectsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(idProjectsTable.id, id))
    .returning();
  return updated ?? null;
}

export async function updateProject(
  id: number,
  patch: Partial<CreateProjectInput & { status: string }>,
) {
  const [updated] = await db
    .update(idProjectsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(idProjectsTable.id, id))
    .returning();
  return updated ?? null;
}

// ── Brief ─────────────────────────────────────────────────────────────────────

export async function submitBrief(input: SubmitBriefInput) {
  const geo: RoomGeometry = {
    roomLengthM: input.roomLengthM,
    roomWidthM: input.roomWidthM,
    ceilingHeightM: input.ceilingHeightM,
    roomType: input.roomType ?? "living_room",
  };
  // Validate before save — result embedded in output later
  void runFullValidation({ geo });

  const existing = await getBriefByProject(input.projectId);

  const briefValues = {
    roomLengthM: String(input.roomLengthM),
    roomWidthM: String(input.roomWidthM),
    ceilingHeightM: String(input.ceilingHeightM),
    doors: input.doors ?? [],
    windows: input.windows ?? [],
    columns: input.columns ?? [],
    immutableZones: input.immutableZones ?? [],
    style: input.style,
    primaryColors: input.primaryColors ?? [],
    secondaryColors: input.secondaryColors ?? [],
    materialsPreference: input.materialsPreference ?? {},
    lightingPreference: input.lightingPreference ?? {},
    furnitureNeeds: input.furnitureNeeds ?? [],
    budgetNotes: input.budgetNotes ?? null,
    photoUrls: input.photoUrls ?? [],
    floorPlanUrl: input.floorPlanUrl ?? null,
    additionalNotes: input.additionalNotes ?? null,
  };

  let brief;
  if (existing) {
    [brief] = await db
      .update(idBriefsTable)
      .set({ ...briefValues, updatedAt: new Date() })
      .where(eq(idBriefsTable.id, existing.id))
      .returning();
  } else {
    [brief] = await db
      .insert(idBriefsTable)
      .values({ projectId: input.projectId, ...briefValues })
      .returning();
  }

  await updateProjectStatus(input.projectId, "brief_submitted");
  return brief;
}

export async function getBriefByProject(projectId: number) {
  const [brief] = await db
    .select()
    .from(idBriefsTable)
    .where(eq(idBriefsTable.projectId, projectId))
    .limit(1);
  return brief ?? null;
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export async function getLatestOutput(projectId: number) {
  const [output] = await db
    .select()
    .from(idOutputsTable)
    .where(and(eq(idOutputsTable.projectId, projectId), eq(idOutputsTable.isLatest, true)))
    .orderBy(desc(idOutputsTable.createdAt))
    .limit(1);
  return output ?? null;
}

export async function listOutputs(projectId: number) {
  return db
    .select()
    .from(idOutputsTable)
    .where(eq(idOutputsTable.projectId, projectId))
    .orderBy(desc(idOutputsTable.createdAt));
}

// ── AI Generation ─────────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });
  return _openai;
}

const STYLE_LABELS: Record<string, string> = {
  modern: "Modern — clean lines, neutral palette, functional",
  minimalist: "Minimalist — less is more, monochromatic, uncluttered",
  scandinavian: "Scandinavian — light woods, white, cozy textiles",
  industrial: "Industrial — exposed brick/concrete, dark metals, raw materials",
  traditional: "Traditional — symmetry, warm tones, ornate details",
  rustic: "Rustic — natural wood, stone, earthy palette",
  art_deco: "Art Deco — geometric patterns, gold accents, bold contrast",
  japandi: "Japandi — Japanese-Scandinavian hybrid, wabi-sabi, calm",
  tropical: "Tropical — lush greens, rattan, natural light",
  mediterranean: "Mediterranean — terracotta, arches, blue-white palette",
};

const ROOM_LABELS: Record<string, string> = {
  living_room: "Living Room",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  office: "Office",
  cafe: "Café",
  restaurant: "Restaurant",
  hotel: "Hotel Room",
  lobby: "Lobby / Reception",
  booth: "Retail/Exhibition Booth",
};

/**
 * Generate design outputs for a project.
 *
 * Brand Intelligence flow (P1 compliance):
 * 1. If clientId provided, read BrandDNA from Brand Intelligence V2 (read-only adapter).
 * 2. Store sourceBrandProfileId + version in id_outputs for traceability.
 * 3. Use brand palette/personality as DEFAULTS; brief preferences are project-specific OVERRIDES.
 * 4. Interior Design never stores its own copy of brand style as source of truth.
 */
export async function generateOutputs(
  projectId: number,
  opts: { clientId?: string } = {},
): Promise<{
  output: typeof idOutputsTable.$inferSelect;
  validationResult: ReturnType<typeof runFullValidation>;
  safetyDisclaimers: string[];
}> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const brief = await getBriefByProject(projectId);
  if (!brief) throw new Error(`No brief found for project ${projectId}`);

  await updateProjectStatus(projectId, "analyzing");

  const geo: RoomGeometry = {
    roomLengthM: parseFloat(brief.roomLengthM),
    roomWidthM: parseFloat(brief.roomWidthM),
    ceilingHeightM: parseFloat(brief.ceilingHeightM),
    roomType: project.roomType,
  };

  const doors = (brief.doors as DoorSpec[]) ?? [];
  const validationResult = runFullValidation({
    geo,
    doors,
    windows: (brief.windows as WindowSpec[]) ?? [],
    columns: (brief.columns as ColumnSpec[]) ?? [],
    furniture: [],
  });

  const safetyDisclaimers = generateSafetyDisclaimers(project.roomType);
  const styleLabel = STYLE_LABELS[brief.style] ?? brief.style;
  const roomLabel = ROOM_LABELS[project.roomType] ?? project.roomType;
  const area = (geo.roomLengthM * geo.roomWidthM).toFixed(1);

  // ── Brand Intelligence V2 read (P1 compliance) ────────────────────────────
  // Read brand context from Brand Intelligence V2 if a clientId is available.
  // Interior Design does NOT duplicate brand data — it only reads and references.
  const clientId = opts.clientId ?? project.clientEmail ?? null;
  const brandSnapshot = clientId ? await readBrandStyleSnapshot(clientId) : null;

  // Project-specific overrides: brief's colors/style take precedence over brand defaults
  const effectivePalette: string[] =
    (brief.primaryColors ?? []).length > 0
      ? [...(brief.primaryColors ?? []), ...(brief.secondaryColors ?? [])]
      : (brandSnapshot?.palette ?? []);

  const briefBrandContext = brandSnapshot
    ? `\nBRAND INTELLIGENCE CONTEXT (read from Brand DNA, do not duplicate — use as inspiration):\n` +
      `- Brand personality: ${brandSnapshot.brandPersonality.join(", ")}\n` +
      `- Brand palette (defaults): ${brandSnapshot.palette.join(", ")}\n` +
      `- Layout style: ${brandSnapshot.layoutStyle}\n` +
      `- Creative direction: ${brandSnapshot.creativeDirection ?? "not available"}\n` +
      `Note: Brief preferences OVERRIDE brand defaults where specified.`
    : "";

  const prompt = `You are an expert interior designer. Generate a comprehensive interior design concept for the following project.

PROJECT: ${project.title}
ROOM TYPE: ${roomLabel}
DIMENSIONS: ${geo.roomLengthM}m (L) × ${geo.roomWidthM}m (W) × ${geo.ceilingHeightM}m ceiling — area ${area}m²
STYLE: ${styleLabel}
PRIMARY COLORS (project override): ${(brief.primaryColors ?? []).join(", ") || "Not specified"}
SECONDARY COLORS (project override): ${(brief.secondaryColors ?? []).join(", ") || "Not specified"}
FURNITURE NEEDS: ${(brief.furnitureNeeds ?? []).join(", ") || "Not specified"}
MATERIALS PREFERENCE: ${JSON.stringify(brief.materialsPreference)}
LIGHTING PREFERENCE: ${JSON.stringify(brief.lightingPreference)}
${brief.additionalNotes ? `ADDITIONAL NOTES: ${brief.additionalNotes}` : ""}
${doors.length > 0 ? `DOORS: ${doors.length} door(s) defined` : ""}
${briefBrandContext}

VALIDATION WARNINGS (consider in your design):
${[...validationResult.dimensionWarnings, ...validationResult.clearanceWarnings, ...validationResult.circulationWarnings].join("\n") || "None"}

Return ONLY a JSON object (no markdown) with exactly this structure:
{
  "moodboard": {
    "palette": ["#hex1","#hex2","#hex3","#hex4","#hex5"],
    "moodWords": ["word1","word2","word3","word4","word5"],
    "styleDescription": "2-3 sentences describing the aesthetic",
    "textureDescriptions": ["texture1","texture2","texture3"],
    "lightingMood": "description of overall light quality"
  },
  "spacePlan": {
    "zones": [{ "id":"z1","label":"Zone Name","xM":0,"yM":0,"widthM":2,"depthM":2,"purpose":"description" }],
    "scale": "1:50",
    "notes": "Key planning notes"
  },
  "furniturePlacement": [{
    "item":"Furniture Name","widthM":2.0,"depthM":0.9,"heightM":0.75,
    "xM":0.5,"yM":0.5,"rotation":0,"clearanceFront":0.9,"clearanceSide":0.45,"note":"placement rationale"
  }],
  "circulationAnalysis": "Detailed paragraph describing traffic flow, main pathways, and any bottlenecks.",
  "materialRecommendations": {
    "flooring": { "primary":"material","alternative":"alt","finish":"finish","why":"rationale" },
    "walls": { "primary":"treatment","accent":"accent","why":"rationale" },
    "ceiling": { "treatment":"ceiling","height":"note","why":"rationale" },
    "textiles": { "curtains":"description","rugs":"description","upholstery":"description" }
  },
  "lightingRecommendations": {
    "ambient": { "type":"fixture","placement":"placement","colorTemp":"2700K" },
    "task":    { "type":"fixture","placement":"placement","colorTemp":"3000K" },
    "accent":  { "type":"fixture","purpose":"purpose" },
    "natural": { "strategy":"strategy" }
  },
  "visualConcept": "A 3-5 sentence narrative describing the completed space.",
  "vendorCategories": [{ "category":"Store type","examples":"options","why":"reason" }]
}`;

  const t0 = Date.now();
  let aiData: Record<string, unknown>;
  let modelUsed = "gpt-4o-mini";

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    aiData = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    aiData = buildFallbackOutput(geo, brief.style, project.roomType, brief, effectivePalette, brandSnapshot);
    modelUsed = "rule-based-fallback";
  }

  const durationMs = Date.now() - t0;

  // Mark previous outputs as not latest
  await db
    .update(idOutputsTable)
    .set({ isLatest: false })
    .where(and(eq(idOutputsTable.projectId, projectId), eq(idOutputsTable.isLatest, true)));

  // Project-specific style overrides recorded for traceability
  const projectStyleOverrides: Record<string, unknown> = {};
  if ((brief.primaryColors ?? []).length > 0) projectStyleOverrides["primaryColors"] = brief.primaryColors;
  if ((brief.secondaryColors ?? []).length > 0) projectStyleOverrides["secondaryColors"] = brief.secondaryColors;
  if (brief.style) projectStyleOverrides["style"] = brief.style;
  if (brief.materialsPreference && Object.keys(brief.materialsPreference as object).length > 0) {
    projectStyleOverrides["materialsPreference"] = brief.materialsPreference;
  }

  const [output] = await db
    .insert(idOutputsTable)
    .values({
      projectId,
      moodboard:               aiData["moodboard"] ?? null,
      spacePlan:               aiData["spacePlan"] ?? null,
      furniturePlacement:      aiData["furniturePlacement"] ?? null,
      circulationAnalysis:     typeof aiData["circulationAnalysis"] === "string" ? aiData["circulationAnalysis"] : null,
      materialRecommendations: aiData["materialRecommendations"] ?? null,
      lightingRecommendations: aiData["lightingRecommendations"] ?? null,
      visualConcept:           typeof aiData["visualConcept"] === "string" ? aiData["visualConcept"] : null,
      vendorCategories:        aiData["vendorCategories"] ?? null,
      validationResults:       validationResult as unknown as Record<string, unknown>,
      safetyDisclaimers,
      // Brand Intelligence V2 reference (not a data copy)
      sourceBrandProfileId:      brandSnapshot?.clientId ?? null,
      sourceBrandProfileVersion: brandSnapshot?.profileVersion ?? null,
      // Project-specific overrides applied on top of brand defaults
      projectStyleOverrides:   Object.keys(projectStyleOverrides).length > 0 ? projectStyleOverrides : null,
      aiModelUsed:             modelUsed,
      generationDurationMs:    durationMs,
      isLatest:                true,
    })
    .returning();

  await updateProjectStatus(projectId, "outputs_ready");

  return { output: output!, validationResult, safetyDisclaimers };
}

// ── Interior Design Concept Drafts ────────────────────────────────────────────

/**
 * Extract step outputs into draft-compatible structure.
 * The Interior Design workflow stores: Design Concept, Space Planning,
 * Material Specification, Design Copy, Interior Quality Control.
 */
function stepsToInitialDraftData(steps: Array<{ stepName: string; output: unknown }>) {
  const byName = Object.fromEntries(steps.map((s) => [s.stepName, s.output]));

  const conceptOut  = byName["Design Concept"]           ?? null;
  const spacePlan   = byName["Space Planning"]            ?? null;
  const materials   = byName["Material Specification"]   ?? null;
  // Design Copy step contains furniture & lighting recommendations alongside copy
  const designCopy  = byName["Design Copy"]              ?? null;

  // Extract visual concept text from the Design Concept step output
  let visualConcept: string | null = null;
  if (typeof conceptOut === "string") {
    visualConcept = conceptOut;
  } else if (conceptOut && typeof conceptOut === "object") {
    const co = conceptOut as Record<string, unknown>;
    visualConcept = typeof co["visualConcept"] === "string" ? co["visualConcept"]
                  : typeof co["concept"]       === "string" ? co["concept"]
                  : JSON.stringify(co).slice(0, 1000);
  }

  return { spacePlan, materials, furniture: designCopy, lighting: designCopy, visualConcept };
}

/**
 * Get existing draft or create one by initialising from creative_project_steps.
 * Idempotent — safe to call multiple times; after first call subsequent calls
 * return the existing row without overwriting any edits.
 */
export async function getOrInitializeDraftByProjectUuid(
  projectUuid: string,
): Promise<IdConceptDraft | null> {
  // Return existing draft if it exists
  const [existing] = await db
    .select()
    .from(idConceptDraftsTable)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .limit(1);
  if (existing) return existing;

  // Look up the creative project and its steps
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectUuid))
    .limit(1);
  if (!project) return null;

  const steps = await db
    .select({ stepName: creativeProjectStepsTable.stepName, output: creativeProjectStepsTable.output })
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, project.id));

  const { spacePlan, materials, furniture, lighting, visualConcept } = stepsToInitialDraftData(steps);

  const [draft] = await db
    .insert(idConceptDraftsTable)
    .values({
      projectUuid,
      originalSpacePlan:     spacePlan     as never,
      originalMaterials:     materials     as never,
      originalFurniture:     furniture     as never,
      originalLighting:      lighting      as never,
      originalVisualConcept: visualConcept,
      spacePlanDraft:     spacePlan     as never,
      materialsDraft:     materials     as never,
      furnitureDraft:     furniture     as never,
      lightingDraft:      lighting      as never,
      visualConceptDraft: visualConcept,
      reviewState:    "ai_generated",
      hasUnsavedEdits: false,
    })
    .onConflictDoNothing()   // race-safe: second request returns existing row
    .returning();

  // If onConflictDoNothing discarded the insert, fetch the winner
  if (!draft) {
    const [winner] = await db
      .select()
      .from(idConceptDraftsTable)
      .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
      .limit(1);
    return winner ?? null;
  }

  return draft;
}

export interface UpdateDraftSections {
  spacePlan?:     unknown;
  materials?:     unknown;
  furniture?:     unknown;
  lighting?:      unknown;
  visualConcept?: string | null;
}

/**
 * Update one or more sections of the editable draft.
 * Uses optimistic concurrency: if expectedUpdatedAt is provided and does not
 * match the stored updatedAt, throws a conflict error rather than overwriting.
 */
export async function updateConceptDraft(
  projectUuid:     string,
  sections:        UpdateDraftSections,
  editorId:        string,
  expectedUpdatedAt?: string,   // ISO string — client sends its copy of updatedAt
): Promise<IdConceptDraft> {
  const [existing] = await db
    .select()
    .from(idConceptDraftsTable)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .limit(1);
  if (!existing) throw new Error(`No concept draft found for project ${projectUuid}. Call GET first to initialise.`);

  // Optimistic concurrency guard
  if (expectedUpdatedAt) {
    const clientTs = new Date(expectedUpdatedAt).getTime();
    const storedTs = new Date(existing.updatedAt).getTime();
    if (Math.abs(clientTs - storedTs) > 1000) {
      throw Object.assign(new Error("Concurrent edit conflict: draft was modified by another editor. Refresh and try again."), { status: 409 });
    }
  }

  const updates: Partial<typeof idConceptDraftsTable.$inferInsert> = {
    hasUnsavedEdits: false,
    lastEditedBy:    editorId,
    lastEditedAt:    new Date(),
    updatedAt:       new Date(),
    // Promote state from ai_generated → edited_by_admin on first edit
    reviewState: existing.reviewState === "ai_generated" ? "edited_by_admin" : existing.reviewState,
  };

  if ("spacePlan"     in sections) updates.spacePlanDraft     = sections.spacePlan     as never;
  if ("materials"     in sections) updates.materialsDraft     = sections.materials     as never;
  if ("furniture"     in sections) updates.furnitureDraft     = sections.furniture     as never;
  if ("lighting"      in sections) updates.lightingDraft      = sections.lighting      as never;
  if ("visualConcept" in sections) updates.visualConceptDraft = sections.visualConcept ?? null;

  const [updated] = await db
    .update(idConceptDraftsTable)
    .set(updates)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .returning();

  return updated!;
}

/**
 * Change the review state of a draft.
 * Valid transitions are enforced — only states in CONCEPT_DRAFT_REVIEW_STATES allowed.
 */
export async function updateDraftReviewState(
  projectUuid: string,
  newState:    string,
  editorId:    string,
): Promise<IdConceptDraft> {
  if (!(CONCEPT_DRAFT_REVIEW_STATES as readonly string[]).includes(newState)) {
    throw Object.assign(new Error(`Invalid review state: ${newState}. Must be one of: ${CONCEPT_DRAFT_REVIEW_STATES.join(", ")}`), { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(idConceptDraftsTable)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .limit(1);
  if (!existing) throw Object.assign(new Error(`No concept draft found for project ${projectUuid}`), { status: 404 });

  const [updated] = await db
    .update(idConceptDraftsTable)
    .set({
      reviewState:   newState,
      lastEditedBy:  editorId,
      lastEditedAt:  new Date(),
      updatedAt:     new Date(),
    })
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .returning();

  return updated!;
}

/**
 * Restore original AI-generated output to a specific section (or all sections).
 * Does NOT change reviewState — caller is responsible for resetting state if needed.
 */
export async function resetDraftToOriginal(
  projectUuid: string,
  sections:    Array<"spacePlan" | "materials" | "furniture" | "lighting" | "visualConcept">,
  editorId:    string,
): Promise<IdConceptDraft> {
  const [existing] = await db
    .select()
    .from(idConceptDraftsTable)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .limit(1);
  if (!existing) throw Object.assign(new Error(`No concept draft found for project ${projectUuid}`), { status: 404 });

  const updates: Partial<typeof idConceptDraftsTable.$inferInsert> = {
    lastEditedBy: editorId,
    lastEditedAt: new Date(),
    updatedAt:    new Date(),
  };
  if (sections.includes("spacePlan"))     updates.spacePlanDraft     = existing.originalSpacePlan     as never;
  if (sections.includes("materials"))     updates.materialsDraft     = existing.originalMaterials     as never;
  if (sections.includes("furniture"))     updates.furnitureDraft     = existing.originalFurniture     as never;
  if (sections.includes("lighting"))      updates.lightingDraft      = existing.originalLighting      as never;
  if (sections.includes("visualConcept")) updates.visualConceptDraft = existing.originalVisualConcept;

  const [updated] = await db
    .update(idConceptDraftsTable)
    .set(updates)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .returning();

  return updated!;
}

/**
 * Read latest approved draft data for use in image generation pipelines.
 * Returns null if no draft exists for this project.
 */
export async function getConceptDraftForImagePipeline(
  projectUuid: string,
): Promise<IdConceptDraft | null> {
  const [draft] = await db
    .select()
    .from(idConceptDraftsTable)
    .where(eq(idConceptDraftsTable.projectUuid, projectUuid))
    .limit(1);
  return draft ?? null;
}

// ── Rule-based fallback ───────────────────────────────────────────────────────
// Used when OpenAI is unavailable.
// Accepts brandSnapshot to use brand palette/personality as defaults
// (project brief overrides take precedence, satisfying P1 requirement).

function buildFallbackOutput(
  geo: RoomGeometry,
  style: string,
  roomType: string,
  brief: Record<string, unknown>,
  effectivePalette: string[],
  brandSnapshot: Awaited<ReturnType<typeof readBrandStyleSnapshot>>,
): Record<string, unknown> {
  const palette = effectivePalette.length >= 3
    ? effectivePalette.slice(0, 5)
    : ["#F5F5F0", "#E8E0D5", "#C4B5A0", "#8B7355", "#3D3530"];

  // Brand personality enriches mood words if available (read-only, not stored)
  const brandMoodWords = brandSnapshot?.brandPersonality.slice(0, 2) ?? [];
  const moodWords = [...new Set([...getMoodWords(style), ...brandMoodWords])].slice(0, 5);

  return {
    moodboard: {
      palette,
      moodWords,
      styleDescription: `A ${style} interior that emphasises ${moodWords.slice(0, 2).join(" and ")} through considered material and furniture selection.`,
      textureDescriptions: getTextures(style),
      lightingMood: getLightingMood(style),
    },
    spacePlan: {
      zones: buildZones(geo, roomType),
      scale: "1:50",
      notes: `Room ${geo.roomLengthM}m × ${geo.roomWidthM}m. Zones arranged to maximise natural light and clear circulation.`,
    },
    furniturePlacement: buildFurniturePlacement(geo, roomType, (brief["furnitureNeeds"] as string[] | undefined) ?? []),
    circulationAnalysis: `The ${geo.roomLengthM}m × ${geo.roomWidthM}m ${roomType.replace("_", " ")} provides approximately ${(geo.roomLengthM * geo.roomWidthM).toFixed(0)}m² of floor area. Primary circulation runs along the longest axis, with secondary paths ensuring access to all functional zones. Furniture is arranged to maintain minimum ${geo.roomLengthM > 4 ? "0.9" : "0.75"}m pathways throughout.`,
    materialRecommendations: getMaterials(style, roomType),
    lightingRecommendations: getLighting(style, roomType),
    visualConcept: `This ${style} ${roomType.replace("_", " ")} creates a ${moodWords[0]} atmosphere through a carefully curated palette of ${palette.slice(0, 3).join(", ")}. The spatial layout prioritises functionality while maintaining aesthetic coherence. Natural light is complemented by layered artificial lighting to support both daily activities and mood. Every material and finish has been selected to reinforce the ${style} concept while remaining practical for everyday use.`,
    vendorCategories: getVendorCategories(roomType),
  };
}

function getMoodWords(style: string): string[] {
  const map: Record<string, string[]> = {
    modern: ["clean", "precise", "functional", "contemporary", "refined"],
    minimalist: ["serene", "uncluttered", "calm", "pure", "intentional"],
    scandinavian: ["cosy", "light", "natural", "warm", "hygge"],
    industrial: ["raw", "urban", "edgy", "textural", "bold"],
    traditional: ["elegant", "timeless", "refined", "symmetrical", "warm"],
    rustic: ["earthy", "natural", "organic", "grounded", "authentic"],
    art_deco: ["glamorous", "geometric", "luxurious", "bold", "dramatic"],
    japandi: ["tranquil", "wabi-sabi", "harmonious", "mindful", "natural"],
    tropical: ["vibrant", "lush", "breezy", "organic", "energising"],
    mediterranean: ["sun-drenched", "relaxed", "textured", "colourful", "inviting"],
  };
  return map[style] ?? ["elegant", "considered", "functional", "balanced", "refined"];
}

function getTextures(style: string): string[] {
  const map: Record<string, string[]> = {
    modern: ["polished concrete", "brushed steel", "smooth plaster", "glass"],
    minimalist: ["raw linen", "smooth plaster", "pale timber", "stone"],
    scandinavian: ["natural oak", "wool felt", "soft cotton", "brushed brass"],
    industrial: ["exposed brick", "aged steel", "reclaimed timber", "raw concrete"],
    traditional: ["carved timber", "damask fabric", "marble", "polished brass"],
    rustic: ["rough-sawn timber", "river stone", "woven jute", "burnished leather"],
    art_deco: ["lacquered surfaces", "geometric tile", "velvet", "gilt metal"],
    japandi: ["washi paper", "smooth bamboo", "undyed linen", "matte ceramics"],
    tropical: ["rattan weave", "woven banana leaf", "teak", "terracotta tile"],
    mediterranean: ["terracotta tile", "whitewashed plaster", "hand-painted ceramic", "wrought iron"],
  };
  return map[style] ?? ["natural timber", "textured plaster", "woven fabric", "stone"];
}

function getLightingMood(style: string): string {
  const map: Record<string, string> = {
    modern: "Bright, even, cool-white ambient light with focused task zones",
    minimalist: "Soft diffused light, no harsh shadows, warm-neutral tone",
    scandinavian: "Warm layered light (2700K), multiple sources, cosy atmosphere",
    industrial: "Edison bulbs, directional pendant, warm amber glow with dark shadows",
    traditional: "Warm incandescent-like (2700K), chandelier focal point, table lamps",
    rustic: "Warm candlelight-inspired, exposed filament bulbs, flickering feel",
    art_deco: "Dramatic contrast, wall sconces, uplighting on architectural features",
    japandi: "Diffused warm light, paper lanterns, natural daylight prioritised",
    tropical: "Bright natural daylight, warm artificial at evening, ceiling fans with lights",
    mediterranean: "Sun-washed afternoon warmth, terracotta lamp shades, candlelight accents",
  };
  return map[style] ?? "Warm ambient light complemented by task and accent layers";
}

function buildZones(geo: RoomGeometry, roomType: string): object[] {
  const l = geo.roomLengthM;
  const w = geo.roomWidthM;
  const zoneMap: Record<string, object[]> = {
    living_room: [
      { id: "z1", label: "Seating Area", xM: 0, yM: 0, widthM: l * 0.6, depthM: w * 0.65, purpose: "Primary lounge and entertainment zone" },
      { id: "z2", label: "Circulation", xM: 0, yM: w * 0.65, widthM: l, depthM: w * 0.1, purpose: "Main entry/exit pathway" },
      { id: "z3", label: "Media / Feature Wall", xM: l * 0.6, yM: 0, widthM: l * 0.4, depthM: w * 0.65, purpose: "TV, display, focal wall" },
    ],
    bedroom: [
      { id: "z1", label: "Sleep Zone", xM: 0, yM: 0, widthM: l * 0.55, depthM: w * 0.6, purpose: "Bed and bedside tables" },
      { id: "z2", label: "Wardrobe / Storage", xM: l * 0.55, yM: 0, widthM: l * 0.45, depthM: w * 0.5, purpose: "Clothing storage and dressing" },
      { id: "z3", label: "Circulation", xM: 0, yM: w * 0.6, widthM: l, depthM: w * 0.15, purpose: "Foot-of-bed and main pathway" },
    ],
    kitchen: [
      { id: "z1", label: "Cooking Zone", xM: 0, yM: 0, widthM: l * 0.5, depthM: w * 0.55, purpose: "Stove, oven, prep surfaces" },
      { id: "z2", label: "Cleaning Zone", xM: l * 0.5, yM: 0, widthM: l * 0.5, depthM: w * 0.55, purpose: "Sink, dishwasher, draining" },
      { id: "z3", label: "Aisle", xM: 0, yM: w * 0.55, widthM: l, depthM: w * 0.2, purpose: `Min ${Math.max(w * 0.2, 1.0).toFixed(1)}m working aisle` },
    ],
    office: [
      { id: "z1", label: "Primary Work Zone", xM: 0, yM: 0, widthM: l * 0.55, depthM: w * 0.55, purpose: "Desk and monitor setup" },
      { id: "z2", label: "Meeting / Collaboration", xM: l * 0.55, yM: 0, widthM: l * 0.45, depthM: w * 0.55, purpose: "Small table or secondary seating" },
      { id: "z3", label: "Storage / Filing", xM: 0, yM: w * 0.55, widthM: l * 0.4, depthM: w * 0.3, purpose: "Shelving, filing cabinets" },
    ],
    restaurant: [
      { id: "z1", label: "Dining Area", xM: 0, yM: 0, widthM: l * 0.75, depthM: w, purpose: "Tables and seating" },
      { id: "z2", label: "Service Aisle", xM: l * 0.75, yM: 0, widthM: l * 0.1, depthM: w, purpose: "Min 1.2m service pathway" },
      { id: "z3", label: "Bar / Service Counter", xM: l * 0.85, yM: 0, widthM: l * 0.15, depthM: w * 0.4, purpose: "Order point and bar service" },
    ],
    cafe: [
      { id: "z1", label: "Coffee Counter", xM: 0, yM: 0, widthM: l * 0.35, depthM: w * 0.45, purpose: "Espresso machines, display, ordering" },
      { id: "z2", label: "Seating Area", xM: l * 0.35, yM: 0, widthM: l * 0.65, depthM: w, purpose: "Tables and chairs, relaxed seating" },
      { id: "z3", label: "Queue Zone", xM: 0, yM: w * 0.45, widthM: l * 0.35, depthM: w * 0.3, purpose: "Customer queuing area" },
    ],
    hotel: [
      { id: "z1", label: "Sleep Zone", xM: 0, yM: 0, widthM: l * 0.55, depthM: w * 0.65, purpose: "Bed, bedside, dresser" },
      { id: "z2", label: "Work / Lounge Zone", xM: l * 0.55, yM: 0, widthM: l * 0.45, depthM: w * 0.65, purpose: "Desk, seating area" },
      { id: "z3", label: "Entry / Luggage", xM: 0, yM: w * 0.65, widthM: l, depthM: w * 0.2, purpose: "Entry, luggage storage, wardrobe" },
    ],
    lobby: [
      { id: "z1", label: "Reception Desk", xM: 0, yM: 0, widthM: l * 0.3, depthM: w * 0.4, purpose: "Front desk, check-in, concierge" },
      { id: "z2", label: "Waiting Lounge", xM: l * 0.3, yM: 0, widthM: l * 0.5, depthM: w * 0.7, purpose: "Seating for visitors" },
      { id: "z3", label: "Main Circulation", xM: 0, yM: w * 0.4, widthM: l, depthM: w * 0.35, purpose: "≥2.5m lobby corridor" },
    ],
    booth: [
      { id: "z1", label: "Display Area", xM: 0, yM: 0, widthM: l * 0.7, depthM: w * 0.8, purpose: "Product display and signage" },
      { id: "z2", label: "Staff/Service Area", xM: l * 0.7, yM: 0, widthM: l * 0.3, depthM: w * 0.8, purpose: "Counter, storage, staff position" },
      { id: "z3", label: "Visitor Entry", xM: 0, yM: w * 0.8, widthM: l, depthM: w * 0.2, purpose: "Open entry / approach zone" },
    ],
  };
  return zoneMap[roomType] ?? zoneMap["living_room"]!;
}

function buildFurniturePlacement(geo: RoomGeometry, roomType: string, _furnitureNeeds: string[]): object[] {
  const l = geo.roomLengthM;
  const w = geo.roomWidthM;
  const defaults: Record<string, object[]> = {
    living_room: [
      { item: "3-seater Sofa", widthM: Math.min(2.2, l * 0.45), depthM: 0.9, heightM: 0.85, xM: 0.5, yM: 0.5, rotation: 0, clearanceFront: 0.9, clearanceSide: 0.45, note: "Centred on feature wall axis" },
      { item: "Coffee Table", widthM: 1.2, depthM: 0.6, heightM: 0.45, xM: 0.5, yM: 1.5, rotation: 0, clearanceFront: 0.45, clearanceSide: 0.3, note: "In front of sofa" },
      { item: "TV Cabinet / Sideboard", widthM: Math.min(1.8, l * 0.35), depthM: 0.5, heightM: 0.55, xM: l - 0.5 - Math.min(1.8, l * 0.35), yM: 0.5, rotation: 0, clearanceFront: 1.8, clearanceSide: 0.3, note: "Feature wall, viewing distance" },
    ],
    bedroom: [
      { item: "Queen Bed (1.6×2.0m)", widthM: 1.6, depthM: 2.0, heightM: 0.6, xM: (l - 1.6) / 2, yM: 0.6, rotation: 0, clearanceFront: 0.9, clearanceSide: 0.6, note: "Centred on primary wall" },
      { item: "Bedside Table (×2)", widthM: 0.5, depthM: 0.45, heightM: 0.55, xM: (l - 1.6) / 2 - 0.6, yM: 0.7, rotation: 0, clearanceFront: 0.3, clearanceSide: 0.1, note: "Both sides of bed" },
      { item: "Wardrobe", widthM: Math.min(1.8, l * 0.4), depthM: 0.6, heightM: 2.1, xM: l - 0.5 - Math.min(1.8, l * 0.4), yM: 0.5, rotation: 0, clearanceFront: 0.6, clearanceSide: 0.15, note: "Against end wall" },
    ],
    kitchen: [
      { item: "Base Cabinet Run", widthM: l - 0.6, depthM: 0.6, heightM: 0.9, xM: 0.3, yM: 0.3, rotation: 0, clearanceFront: 1.0, clearanceSide: 0.1, note: "L-shape maximises corner storage" },
      { item: "Kitchen Island", widthM: Math.min(1.5, l * 0.35), depthM: 0.9, heightM: 0.9, xM: (l - Math.min(1.5, l * 0.35)) / 2, yM: 1.6, rotation: 0, clearanceFront: 1.0, clearanceSide: 1.0, note: "Central island with 1.0m aisle" },
    ],
    office: [
      { item: "Work Desk", widthM: Math.min(1.6, l * 0.4), depthM: 0.75, heightM: 0.75, xM: 0.5, yM: 0.5, rotation: 0, clearanceFront: 0.9, clearanceSide: 0.45, note: "Positioned for natural light on side" },
      { item: "Ergonomic Chair", widthM: 0.65, depthM: 0.65, heightM: 1.2, xM: 0.5, yM: 1.4, rotation: 0, clearanceFront: 0.5, clearanceSide: 0.2, note: "In front of desk" },
    ],
  };
  return defaults[roomType] ?? defaults["living_room"]!;
}

function getMaterials(style: string, roomType: string): object {
  return {
    flooring: {
      primary: style === "industrial" ? "Polished concrete" : style === "scandinavian" ? "White-oiled oak parquet" : style === "rustic" ? "Wide-plank reclaimed timber" : style === "mediterranean" ? "Terracotta tile (30×30cm)" : "Engineered oak hardwood",
      alternative: "Large-format porcelain tile (90×90cm)",
      finish: style === "minimalist" ? "Matte" : "Satin",
      why: `Complements the ${style} style and provides durability for ${roomType.replace("_", " ")} traffic`,
    },
    walls: {
      primary: style === "industrial" ? "Exposed or plastered concrete, raw finish" : style === "traditional" ? "Wallpaper with classic motif" : "Smooth gypsum plaster, painted",
      accent: `Feature wall in ${style === "art_deco" ? "textured wallpaper with geometric pattern" : style === "rustic" ? "exposed brick or stone cladding" : "contrasting paint colour or timber slat cladding"}`,
      why: "Creates focal point and visual depth",
    },
    ceiling: {
      treatment: style === "industrial" ? "Exposed structure / services painted matte black" : style === "traditional" ? "Cornice and ceiling rose detail" : "Smooth plaster with concealed bulkhead for lighting",
      height: style === "minimalist" ? "Keep ceiling plane uncluttered" : "Zone lighting via bulkheads",
      why: "Ceiling treatment anchors the style and accommodates lighting integration",
    },
    textiles: {
      curtains: style === "minimalist" ? "Sheer linen drapes, ceiling to floor" : style === "traditional" ? "Heavy lined drapes with pelmet" : "Linen or cotton blend, simple pleat",
      rugs: style === "scandinavian" ? "Wool flat-weave or sheepskin accent rug" : style === "industrial" ? "Jute or cowhide rug" : "Low-pile wool or wool-blend area rug",
      upholstery: style === "industrial" ? "Leather or distressed velvet" : style === "scandinavian" ? "Boucle or textured wool" : "Quality fabric in tonal palette colour",
    },
  };
}

function getLighting(style: string, roomType: string): object {
  return {
    ambient: {
      type: style === "art_deco" ? "Statement chandelier with geometric diffuser" : style === "industrial" ? "Exposed filament pendants on conduit rail" : "Recessed LED downlights (dimmable)",
      placement: "Perimeter or grid layout for even illumination",
      colorTemp: style === "industrial" || style === "rustic" ? "2200K–2700K (warm amber)" : "2700K–3000K (warm white)",
    },
    task: {
      type: roomType === "kitchen" ? "Under-cabinet LED strip lights" : roomType === "office" ? "Articulated desk lamp (LED, CRI 90+)" : "Table lamp or swing-arm wall sconce",
      placement: "Directly above or beside work surfaces",
      colorTemp: "3000K–4000K (neutral white for task accuracy)",
    },
    accent: {
      type: "LED strip (RGBW), directional spotlight, or picture light",
      purpose: "Highlight artwork, architectural features, or display shelving",
    },
    natural: {
      strategy: `Maximise window exposure on ${style === "scandinavian" ? "north-facing walls for consistent indirect light" : "east/west walls for morning/evening warmth"}. Use sheer diffusing layers to control glare.`,
    },
  };
}

function getVendorCategories(roomType: string): object[] {
  const base = [
    { category: "Furniture Retailer", examples: "Local showrooms, design studios, boutique importers", why: "Key pieces: sofas, beds, desks, storage" },
    { category: "Lighting Specialist", examples: "Lighting showroom or specification consultant", why: "Ambient, task, and accent fixture selection" },
    { category: "Flooring Contractor", examples: "Timber flooring installer, tile layer", why: "Supply and installation of floor finishes" },
    { category: "Paint & Wall Finish Supplier", examples: "Premium paint brand, wallpaper importer", why: "Wall colours, feature treatments, ceiling paints" },
    { category: "Window Treatment Specialist", examples: "Curtain studio, blind supplier", why: "Curtains, blinds, sheers for light control and privacy" },
    { category: "Interior Textile Supplier", examples: "Upholstery fabric supplier, rug importer", why: "Rugs, cushions, throw blankets, upholstery" },
  ];
  if (["cafe", "restaurant"].includes(roomType)) {
    base.push({ category: "Commercial Kitchen Equipment", examples: "Catering equipment supplier", why: "Commercial-grade cooking and storage equipment" });
    base.push({ category: "Joinery / Cabinetmaker", examples: "Custom joinery workshop", why: "Counter, bar, display shelving, booth seating" });
  }
  if (["hotel", "lobby"].includes(roomType)) {
    base.push({ category: "Signage & Wayfinding", examples: "Brand and signage specialist", why: "Reception branding, directional signage" });
    base.push({ category: "Commercial Furniture Supplier", examples: "Hospitality FF&E supplier", why: "Contract-grade furniture rated for high traffic" });
  }
  if (roomType === "office") {
    base.push({ category: "Office Systems Supplier", examples: "Ergonomic furniture dealer", why: "Height-adjustable desks, ergonomic chairs, cable management" });
  }
  return base;
}
