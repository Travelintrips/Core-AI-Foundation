/**
 * Team 28 — Furniture & Product Design Plugin — Service Layer
 *
 * Handles project lifecycle, brief capture, AI-assisted output generation
 * for each workflow step, and export packaging.
 *
 * Compliance notes:
 *  - No CAD runtime, parametric modelling, or simulation engine.
 *  - AI provider is not hard-coded — reads from env at runtime.
 *  - Schema imported from domain-local ./schema.ts (NOT @workspace/db barrel).
 *  - Access token is the IDOR guard; never accept numeric projectId from public callers.
 *  - Falls back to rule-based output when AI unavailable.
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

import { db } from "@workspace/db";
import {
  pdPluginProjectsTable,
  pdPluginBriefsTable,
  pdPluginOutputsTable,
  PD_PROJECT_STATUSES,
  type PdProjectStatus,
  type PdWorkflowStep,
} from "./schema.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import {
  validateBrief,
  validateStepTransition,
  validateStatusTransition,
  assertNoCadRuntime,
  type BriefValidationInput,
  type TechnicalViewMetadata,
} from "./validation.js";
import {
  PLUGIN_MANIFEST,
  ARTIFACT_TYPE_KEYS,
  WORKFLOW_STEPS,
  type ProductArtifactType,
  type WorkflowStepKey,
} from "./plugin-manifest.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  title: string;
  productCategory: string;
  clientName?: string;
  clientEmail?: string;
  notes?: string;
}

export interface SubmitBriefInput extends BriefValidationInput {
  projectId: number;
  ergonomicsNotes?: string;
  loadUsageNotes?: string;
  finishPreferences?: Record<string, string>;
  manufacturingProcess?: string;
  productionVolume?: string;
  budgetCurrency?: string;
  budgetEstimate?: number;
  budgetNotes?: string;
  sustainabilityGoals?: string;
  safetyRequirements?: string;
  complianceStandards?: string[];
  referenceUrls?: string[];
  additionalNotes?: string;
}

export interface GenerateStepInput {
  projectId: number;
  step: WorkflowStepKey;
}

export interface ListProjectsOptions {
  status?: PdProjectStatus;
  productCategory?: string;
  page?: number;
  pageSize?: number;
}

// ── OpenAI client (lazy singleton) ────────────────────────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });
  }
  return _openai;
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

export async function createProject(input: CreateProjectInput) {
  const [row] = await db
    .insert(pdPluginProjectsTable)
    .values({
      title: input.title,
      productCategory: input.productCategory,
      clientName: input.clientName ?? null,
      clientEmail: input.clientEmail ?? null,
      notes: input.notes ?? null,
      status: "draft",
      currentStep: "brief",
      completedSteps: [],
      accessToken: randomUUID(),
    })
    .returning();
  return row;
}

export async function listProjects(opts: ListProjectsOptions = {}) {
  const { status, productCategory, page = 1, pageSize = 20 } = opts;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (status) conditions.push(eq(pdPluginProjectsTable.status, status));
  if (productCategory) conditions.push(eq(pdPluginProjectsTable.productCategory, productCategory));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(pdPluginProjectsTable)
      .where(where)
      .orderBy(desc(pdPluginProjectsTable.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(pdPluginProjectsTable)
      .where(where),
  ]);

  return { items: rows, total: countResult[0]?.count ?? 0, page, pageSize };
}

export async function getProject(id: number) {
  const [project] = await db
    .select()
    .from(pdPluginProjectsTable)
    .where(eq(pdPluginProjectsTable.id, id))
    .limit(1);
  return project ?? null;
}

export async function getProjectByToken(token: string) {
  if (!token || token.length < 8) return null;
  const [project] = await db
    .select()
    .from(pdPluginProjectsTable)
    .where(eq(pdPluginProjectsTable.accessToken, token))
    .limit(1);
  return project ?? null;
}

export async function updateProjectStatus(id: number, status: PdProjectStatus) {
  const [updated] = await db
    .update(pdPluginProjectsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(pdPluginProjectsTable.id, id))
    .returning();
  return updated ?? null;
}

export async function advanceProjectStep(id: number, completedStep: PdWorkflowStep, nextStep: PdWorkflowStep | null) {
  const project = await getProject(id);
  if (!project) return null;

  const completedSteps = [...((project.completedSteps as string[]) ?? [])];
  if (!completedSteps.includes(completedStep)) {
    completedSteps.push(completedStep);
  }

  const [updated] = await db
    .update(pdPluginProjectsTable)
    .set({
      completedSteps,
      currentStep: nextStep ?? completedStep,
      updatedAt: new Date(),
    })
    .where(eq(pdPluginProjectsTable.id, id))
    .returning();
  return updated ?? null;
}

// ── Brief ─────────────────────────────────────────────────────────────────────

export async function submitBrief(input: SubmitBriefInput) {
  const validation = validateBrief(input);
  if (!validation.valid) {
    throw new Error(
      `Brief validation failed: ${validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`
    );
  }

  const existing = await getBriefByProject(input.projectId);

  const briefValues = {
    productCategory:     input.productCategory,
    targetUser:          input.targetUser,
    environment:         input.environment,
    primaryFunction:     input.primaryFunction,
    widthMm:             input.widthMm != null ? String(input.widthMm) : null,
    depthMm:             input.depthMm != null ? String(input.depthMm) : null,
    heightMm:            input.heightMm != null ? String(input.heightMm) : null,
    weightKg:            input.weightKg != null ? String(input.weightKg) : null,
    ergonomicsNotes:     input.ergonomicsNotes ?? null,
    loadUsageNotes:      input.loadUsageNotes ?? null,
    primaryMaterials:    input.primaryMaterials ?? [],
    finishPreferences:   input.finishPreferences ?? {},
    manufacturingProcess: input.manufacturingProcess ?? null,
    productionVolume:    input.productionVolume ?? null,
    budgetCurrency:      input.budgetCurrency ?? "IDR",
    budgetEstimate:      input.budgetEstimate != null ? String(input.budgetEstimate) : null,
    budgetNotes:         input.budgetNotes ?? null,
    sustainabilityGoals: input.sustainabilityGoals ?? null,
    safetyRequirements:  input.safetyRequirements ?? null,
    complianceStandards: input.complianceStandards ?? [],
    referenceUrls:       input.referenceUrls ?? [],
    additionalNotes:     input.additionalNotes ?? null,
  };

  let brief;
  if (existing) {
    [brief] = await db
      .update(pdPluginBriefsTable)
      .set({ ...briefValues, updatedAt: new Date() })
      .where(eq(pdPluginBriefsTable.id, existing.id))
      .returning();
  } else {
    [brief] = await db
      .insert(pdPluginBriefsTable)
      .values({ projectId: input.projectId, ...briefValues })
      .returning();
  }

  await updateProjectStatus(input.projectId, "brief_submitted");
  return { brief, warnings: validation.warnings };
}

export async function getBriefByProject(projectId: number) {
  const [brief] = await db
    .select()
    .from(pdPluginBriefsTable)
    .where(eq(pdPluginBriefsTable.projectId, projectId))
    .limit(1);
  return brief ?? null;
}

// ── Output generation ─────────────────────────────────────────────────────────

/**
 * Generates AI-assisted output for a specific workflow step.
 * Never invokes CAD or simulation — text/structured-data only.
 */
export async function generateStepOutput(input: GenerateStepInput) {
  // Hard cap: ensure no CAD runtime slips in
  assertNoCadRuntime("cad_runtime");

  const project = await getProject(input.projectId);
  if (!project) throw new Error(`Project ${input.projectId} not found.`);

  const brief = await getBriefByProject(input.projectId);
  if (!brief) throw new Error(`No brief found for project ${input.projectId}. Submit brief first.`);

  const stepDef = WORKFLOW_STEPS.find((s) => s.key === input.step);
  if (!stepDef) throw new Error(`Unknown workflow step "${input.step}".`);

  const artifactType = stepDef.outputArtifactType;
  if (!artifactType) {
    // Steps like "brief", "functional_requirements", "review" don't produce AI outputs
    return { skipped: true, reason: `Step "${input.step}" does not produce a generated artifact.` };
  }

  // Mark previous output for this step as not-latest
  await db
    .update(pdPluginOutputsTable)
    .set({ isLatest: false })
    .where(
      and(
        eq(pdPluginOutputsTable.projectId, input.projectId),
        eq(pdPluginOutputsTable.workflowStep, input.step),
        eq(pdPluginOutputsTable.isLatest, true)
      )
    );

  const t0 = Date.now();
  let content: Record<string, unknown>;
  let modelUsed = "gpt-4o-mini";

  const prompt = buildPrompt(input.step, stepDef.label, project, brief);

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    content = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    content = buildFallbackContent(input.step, project, brief);
    modelUsed = "rule-based-fallback";
  }

  const durationMs = Date.now() - t0;
  const disclaimers = getDisclaimers(input.step);

  const [output] = await db
    .insert(pdPluginOutputsTable)
    .values({
      projectId: input.projectId,
      workflowStep: input.step,
      artifactType,
      content,
      disclaimers,
      aiModelUsed: modelUsed,
      generationDurationMs: durationMs,
      isApproved: false,
      isLatest: true,
    })
    .returning();

  return { output: output!, skipped: false };
}

export async function getLatestOutput(projectId: number, step: WorkflowStepKey) {
  const [output] = await db
    .select()
    .from(pdPluginOutputsTable)
    .where(
      and(
        eq(pdPluginOutputsTable.projectId, projectId),
        eq(pdPluginOutputsTable.workflowStep, step),
        eq(pdPluginOutputsTable.isLatest, true)
      )
    )
    .orderBy(desc(pdPluginOutputsTable.createdAt))
    .limit(1);
  return output ?? null;
}

export async function listOutputs(projectId: number) {
  return db
    .select()
    .from(pdPluginOutputsTable)
    .where(eq(pdPluginOutputsTable.projectId, projectId))
    .orderBy(desc(pdPluginOutputsTable.createdAt));
}

export async function approveOutput(outputId: number, reviewNotes?: string) {
  const [updated] = await db
    .update(pdPluginOutputsTable)
    .set({ isApproved: true, reviewNotes: reviewNotes ?? null, updatedAt: new Date() })
    .where(eq(pdPluginOutputsTable.id, outputId))
    .returning();
  return updated ?? null;
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Packages all approved outputs for a project into an export manifest.
 * Does NOT write to object storage (requires Team 39 integration for signed URLs).
 */
export async function exportProject(projectId: number) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found.`);

  if (project.status !== "approved") {
    throw new Error(
      `Project must be in "approved" status before export. Current: "${project.status}".`
    );
  }

  const allOutputs = await listOutputs(projectId);
  const approvedOutputs = allOutputs.filter((o) => o.isApproved && o.isLatest);

  const exportManifest = {
    pluginId: PLUGIN_MANIFEST.pluginId,
    pluginVersion: PLUGIN_MANIFEST.version,
    projectId,
    projectTitle: project.title,
    productCategory: project.productCategory,
    exportedAt: new Date().toISOString(),
    artifacts: approvedOutputs.map((o) => ({
      workflowStep: o.workflowStep,
      artifactType: o.artifactType,
      content: o.content,
      disclaimers: o.disclaimers,
      approvedAt: o.updatedAt,
    })),
    missingArtifacts: (ARTIFACT_TYPE_KEYS as readonly string[]).filter(
      (t) => !approvedOutputs.some((o) => o.artifactType === t)
    ),
  };

  await db
    .update(pdPluginProjectsTable)
    .set({ status: "exported", exportedAt: new Date(), updatedAt: new Date() })
    .where(eq(pdPluginProjectsTable.id, projectId));

  return exportManifest;
}

// ── Plugin manifest ───────────────────────────────────────────────────────────

export function getPluginManifest() {
  return PLUGIN_MANIFEST;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildPrompt(
  step: WorkflowStepKey,
  stepLabel: string,
  project: Awaited<ReturnType<typeof getProject>>,
  brief: Awaited<ReturnType<typeof getBriefByProject>>,
): string {
  if (!project || !brief) return "{}";

  const ctx = `
PRODUCT: ${project.title}
CATEGORY: ${project.productCategory}
TARGET USER: ${brief.targetUser}
ENVIRONMENT: ${brief.environment}
PRIMARY FUNCTION: ${brief.primaryFunction}
DIMENSIONS (mm): W=${brief.widthMm ?? "TBD"} D=${brief.depthMm ?? "TBD"} H=${brief.heightMm ?? "TBD"}
MATERIALS: ${(brief.primaryMaterials as string[]).join(", ") || "TBD"}
MANUFACTURING: ${brief.manufacturingProcess ?? "TBD"}
SUSTAINABILITY: ${brief.sustainabilityGoals ?? "none specified"}
SAFETY: ${brief.safetyRequirements ?? "none specified"}
COMPLIANCE: ${(brief.complianceStandards as string[]).join(", ") || "none specified"}
BUDGET: ${brief.budgetCurrency} ${brief.budgetEstimate ?? "TBD"}
${brief.additionalNotes ? `ADDITIONAL NOTES: ${brief.additionalNotes}` : ""}`.trim();

  const prompts: Partial<Record<WorkflowStepKey, string>> = {
    user_market_research: `You are a product design researcher. Generate a moodboard and market brief for a ${project.productCategory} product.
${ctx}
Return ONLY valid JSON (no markdown):
{
  "palette": ["#hex1","#hex2","#hex3","#hex4","#hex5"],
  "moodWords": ["word1","word2","word3","word4","word5"],
  "targetUserPersona": "2-sentence user persona",
  "marketPositioning": "2-sentence market position",
  "competitorCategories": ["category1","category2","category3"],
  "designOpportunities": ["opportunity1","opportunity2"],
  "references": ["style reference 1","style reference 2"]
}`,

    concept_direction: `You are a senior product designer. Generate concept direction for a ${project.productCategory}.
${ctx}
Return ONLY valid JSON:
{
  "palette": ["#hex1","#hex2","#hex3","#hex4","#hex5"],
  "moodWords": ["word1","word2","word3","word4","word5"],
  "aestheticDirection": "2-3 sentence description of the visual language",
  "formVocabulary": "key form principles (e.g. 'tapered legs, chamfered edges')",
  "inspirationSources": ["source1","source2","source3"],
  "colorRationale": "Why this palette works for this product and user"
}`,

    concept_sketch: `You are a product designer creating concept sketches.
${ctx}
Return ONLY valid JSON:
{
  "thumbnailConcepts": [
    {"id":"c1","silhouette":"description","keyFeature":"standout detail","prosConsNote":"brief note"},
    {"id":"c2","silhouette":"description","keyFeature":"standout detail","prosConsNote":"brief note"},
    {"id":"c3","silhouette":"description","keyFeature":"standout detail","prosConsNote":"brief note"}
  ],
  "selectedConcept": "c1",
  "selectionRationale": "Why this concept best satisfies the brief",
  "sketchNotes": "Key observations from the ideation process"
}`,

    form_development: `You are a product designer developing the selected form for a ${project.productCategory}.
${ctx}
Return ONLY valid JSON:
{
  "proportionNotes": "Key proportion decisions and rationale",
  "keyAngles": "Primary angles and curves used",
  "ergonomicMappings": [{"bodyPart":"part","interaction":"how it contacts product","dimension":"key mm measurement"}],
  "joineryLogic": "Main structural connection strategy",
  "surfaceArticulation": "How surfaces are detailed (edges, radii, transitions)",
  "formStudySummary": "2-3 sentence summary of the developed form"
}`,

    material_component_selection: `You are a materials and components specialist for furniture/product design.
${ctx}
Return ONLY valid JSON:
{
  "primaryMaterial": {"key":"material_key","grade":"grade","reason":"why selected","sustainability":"sustainability note"},
  "secondaryMaterials": [{"key":"material_key","role":"role in product","grade":"grade"}],
  "finishSchedule": [{"surface":"surface description","finish":"finish type","sheen":"matte|satin|gloss","colorRef":"color description"}],
  "hardwareList": [{"type":"hardware type","spec":"size or part number","quantity":1,"supplier":"category"}],
  "estimatedMaterialCost": "IDR range estimate",
  "sustainabilityScore": "1-10 with rationale"
}`,

    orthographic_technical_view: `You are a technical illustrator. Generate orthographic view annotations for a ${project.productCategory}.
${ctx}
Return ONLY valid JSON:
{
  "views": [
    {"view":"front","keyDimensions":[{"label":"Overall Width","valueMm":${brief.widthMm ?? 600}},{"label":"Overall Height","valueMm":${brief.heightMm ?? 750}}],"notes":"Key feature on front view"},
    {"view":"side","keyDimensions":[{"label":"Overall Depth","valueMm":${brief.depthMm ?? 500}}],"notes":"Key feature on side view"},
    {"view":"top","keyDimensions":[],"notes":"Top view notes"}
  ],
  "scale":"1:10",
  "unit":"mm",
  "annotations":["key dimension 1","key dimension 2","key dimension 3"],
  "sectionNotes":"Critical section cut locations and what they reveal",
  "toleranceNotes":"Key dimensional tolerances for manufacturing"
}`,

    visualization: `You are a creative director writing image generation prompts for a ${project.productCategory}.
IMPORTANT: Generate descriptive PROMPTS only — do NOT claim to generate images.
${ctx}
Return ONLY valid JSON:
{
  "heroPrompt": "Detailed photorealistic image generation prompt for hero shot",
  "lifestylePrompt": "Prompt for lifestyle/in-context shot with the target user and environment",
  "detailPrompts": ["close-up detail prompt 1","close-up detail prompt 2"],
  "colorwayVariants": ["prompt variation for colorway 1","prompt variation for colorway 2"],
  "visualNotes": "Camera angle, lighting, and styling direction",
  "renderStyle": "photorealistic|studio|lifestyle|sketch"
}`,

    prototype_specification: `You are a prototyping specialist for a ${project.productCategory}.
${ctx}
Return ONLY valid JSON:
{
  "bomItems": [{"item":"component name","material":"material","dimensions":"key dimensions","quantity":1,"finishNotes":"finish"}],
  "joinery": [{"joint":"joint type","location":"where used","method":"how to execute"}],
  "assemblySequence": ["step 1","step 2","step 3","step 4"],
  "finishSchedule": [{"surface":"surface","products":"products to use","applicationMethod":"method"}],
  "toolsRequired": ["tool1","tool2"],
  "estimatedPrototypeDays": 5,
  "riskNotes": ["risk 1","risk 2"]
}`,

    export: `You are a product design documentation specialist.
${ctx}
Return ONLY valid JSON:
{
  "productionReadiness": "assessment of readiness for production",
  "unresolved": ["any outstanding issue 1","any outstanding issue 2"],
  "nextSteps": ["recommended next step 1","recommended next step 2"],
  "ipNotice": "All design outputs are the property of the commissioning client. No CAD files are generated by this plugin.",
  "exportSummary": "2-sentence summary of what is included in this export package"
}`,
  };

  return prompts[step] ?? `Generate a JSON object for the "${stepLabel}" step of a furniture/product design project.\n${ctx}\nReturn ONLY valid JSON with relevant fields.`;
}

// ── Rule-based fallbacks ──────────────────────────────────────────────────────

function buildFallbackContent(
  step: WorkflowStepKey,
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>,
  brief: NonNullable<Awaited<ReturnType<typeof getBriefByProject>>>,
): Record<string, unknown> {
  const cat = project.productCategory;

  const fallbacks: Partial<Record<WorkflowStepKey, Record<string, unknown>>> = {
    user_market_research: {
      palette: ["#F5F0EB", "#D4C5B0", "#8B7355", "#4A3728", "#1C1410"],
      moodWords: ["functional", "considered", "durable", "honest", "refined"],
      targetUserPersona: `A user who needs a ${cat} for ${brief.environment}. Values quality craftsmanship and practical design.`,
      marketPositioning: `Mid-to-premium ${cat} for ${brief.environment} use. Competes on material quality and longevity.`,
      competitorCategories: ["mass-market flatpack", "artisan custom", "mid-range branded"],
      designOpportunities: ["material transparency", "assembly experience", "end-of-life recyclability"],
      references: ["Scandinavian woodcraft tradition", "Japanese joinery precision", "Bauhaus material honesty"],
    },
    concept_sketch: {
      thumbnailConcepts: [
        { id: "c1", silhouette: `Classic ${cat} form — familiar proportion, refined details`, keyFeature: "Traditional joinery exposed as decorative element", prosConsNote: "Safe appeal, low risk" },
        { id: "c2", silhouette: `Reduced ${cat} — minimal material, structural geometry`, keyFeature: "Visible structural logic as aesthetic", prosConsNote: "Modern appeal, requires precision manufacturing" },
        { id: "c3", silhouette: `Modular ${cat} — reconfigurable components`, keyFeature: "User adaptability over product lifetime", prosConsNote: "Higher complexity, stronger value proposition" },
      ],
      selectedConcept: "c2",
      selectionRationale: "Best balances manufacturing feasibility with the brief's sustainability and functional requirements.",
      sketchNotes: "All three concepts share the core material palette. C2 has strongest alignment with brief.",
    },
    orthographic_technical_view: {
      views: [
        { view: "front", keyDimensions: [{ label: "Overall Width", valueMm: Number(brief.widthMm) || 600 }, { label: "Overall Height", valueMm: Number(brief.heightMm) || 750 }], notes: "Primary view — shows main proportions and front panel treatment" },
        { view: "side", keyDimensions: [{ label: "Overall Depth", valueMm: Number(brief.depthMm) || 500 }], notes: "Side elevation — shows leg profile and stretcher position" },
        { view: "top", keyDimensions: [], notes: "Plan view — shows top surface layout and structure below" },
      ],
      scale: "1:10",
      unit: "mm",
      annotations: [`W ${brief.widthMm ?? "TBD"}mm`, `D ${brief.depthMm ?? "TBD"}mm`, `H ${brief.heightMm ?? "TBD"}mm`],
      sectionNotes: "Section A-A through leg-to-rail joint to show joinery detail.",
      toleranceNotes: "±1mm on structural dimensions, ±0.5mm on visible joinery faces.",
    },
  };

  return fallbacks[step] ?? {
    step,
    category: cat,
    note: `Rule-based placeholder for "${step}". AI generation unavailable — retry when API key is configured.`,
    briefSummary: {
      product: project.title,
      category: cat,
      environment: brief.environment,
      primaryFunction: brief.primaryFunction,
    },
  };
}

function getDisclaimers(step: WorkflowStepKey): string[] {
  const base = [
    "This output is AI-assisted and should be reviewed by a qualified designer before use in manufacturing.",
    "This plugin does not generate CAD files, parametric models, or structural simulations.",
  ];

  const stepDisclaimers: Partial<Record<WorkflowStepKey, string[]>> = {
    orthographic_technical_view: [
      "Dimensions shown are indicative. All dimensions must be verified by a draughting professional before production.",
    ],
    prototype_specification: [
      "BOM quantities and costs are estimates. Obtain supplier quotes before committing to production.",
    ],
    visualization: [
      "Visualization prompts describe images — no images are generated by this plugin.",
    ],
    export: [
      "All design outputs are the intellectual property of the commissioning client.",
      "This export package does not include manufacturing drawings or CAD data.",
    ],
  };

  return [...base, ...(stepDisclaimers[step] ?? [])];
}
