/**
 * imagePreviewService — Two-Stage Image Generation Pipeline.
 *
 * Pipeline:
 *   1. startPreviewSession() → create render session, fire preview generation in background
 *   2. runPreviewGeneration() → generate N cheap concept images (no QC — fast + cheap)
 *   3. selectConcept()        → customer picks a concept, AI refines prompt
 *   4. runFinalGeneration()   → generate final images with full QC
 *   5. generateMorePreviews() → customer asks for additional concepts
 *
 * Package tiers (final render quality):
 *   standard   → FLUX Schnell, quality=80
 *   premium    → FLUX Dev, quality=90
 *   enterprise → FLUX Dev, quality=95
 *
 * Preview always uses the cheapest model (FLUX Schnell, quality=70).
 * QC runs ONLY on final images, never on previews.
 */

import { eq, and, sql, desc } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  creativeAiAssetsTable,
  creativeRenderSessionsTable,
} from "@workspace/db";
import { idProjectsTable, idBriefsTable } from "../domains/interior-design/schema.js";
import { executeAI } from "./aiExecutionService.js";
import { getProviderApiKey } from "./aiSecretService.js";
import { logAudit } from "./aiAuditService.js";
import { recordCost } from "./costService.js";
import { readGuardrails } from "./guardrailService.js";
import { getPublicBaseUrl } from "../lib/publicBaseUrl.js";

// ── Model constants ───────────────────────────────────────────────────────────

const FLUX_SCHNELL = "black-forest-labs/flux-schnell";
const FLUX_DEV = "black-forest-labs/flux-dev";

const TIER_CONFIG = {
  standard:   { model: FLUX_SCHNELL, outputQuality: 80, costPerImage: 0.003 },
  premium:    { model: FLUX_DEV,     outputQuality: 90, costPerImage: 0.025 },
  enterprise: { model: FLUX_DEV,     outputQuality: 95, costPerImage: 0.025 },
} as const;

const PREVIEW_CONFIG = {
  model: FLUX_SCHNELL,
  outputQuality: 70,
  costPerImage: 0.003,
  // Estimated time and cost for final render (shown on concept card)
  estimatedFinalCostUsd: { standard: 0.003, premium: 0.025, enterprise: 0.025 },
  estimatedRenderTimeMs: { standard: 15000, premium: 45000, enterprise: 60000 },
};

/** Final images must pass this gate before they can be approved by a customer. */
export const FINAL_QC_THRESHOLD = 80;

type PipelineSourceContext = {
  sourceType: "creative" | "interior";
  projectRef: string;
  numericProjectId: number;
  brief: Record<string, unknown>;
  brandStrategy: Record<string, unknown>;
  creativeDirection: Record<string, unknown>;
};

/**
 * The image pipeline is shared by creative-project UUIDs and the Interior
 * Design brief domain. Interior IDs are deliberately namespaced as
 * `interior:<numeric-id>` so the two identity systems can never be confused.
 */
async function loadPipelineSourceContext(
  projectRef: string,
  numericProjectId?: number,
): Promise<PipelineSourceContext | null> {
  if (projectRef.startsWith("interior:")) {
    const id = Number.parseInt(projectRef.slice("interior:".length), 10);
    if (!Number.isInteger(id) || id <= 0) return null;

    const [project] = await db.select().from(idProjectsTable).where(eq(idProjectsTable.id, id)).limit(1);
    const [brief] = await db.select().from(idBriefsTable).where(eq(idBriefsTable.projectId, id)).limit(1);
    if (!project || !brief) return null;

    return {
      sourceType: "interior",
      projectRef,
      numericProjectId: id,
      brief: {
        domain: "interior",
        title: project.title,
        roomType: project.roomType,
        roomLengthM: brief.roomLengthM,
        roomWidthM: brief.roomWidthM,
        ceilingHeightM: brief.ceilingHeightM,
        stylePreference: brief.style,
        primaryColors: brief.primaryColors,
        secondaryColors: brief.secondaryColors,
        furnitureNeeds: brief.furnitureNeeds,
        materialsPreference: brief.materialsPreference,
        lightingPreference: brief.lightingPreference,
        additionalNotes: brief.additionalNotes,
      },
      brandStrategy: {},
      creativeDirection: {},
    };
  }

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectRef));
  if (!project) return null;

  const steps = await db
    .select()
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, numericProjectId ?? project.id));

  return {
    sourceType: "creative",
    projectRef,
    numericProjectId: numericProjectId ?? project.id,
    brief: {
      domain: "creative",
      brandName: project.brandName,
      businessType: project.businessType,
      targetMarket: project.targetMarket,
      productOrService: project.productOrService,
      stylePreference: project.stylePreference,
      goal: project.goal,
    },
    brandStrategy:
      (steps.find((s) => s.stepName === "Brand Strategy")?.output as Record<string, unknown>) ?? {},
    creativeDirection:
      (steps.find((s) => s.stepName === "Creative Direction")?.output as Record<string, unknown>) ?? {},
  };
}

async function updatePipelineSourceStatus(projectRef: string, status: string): Promise<void> {
  if (projectRef.startsWith("interior:")) {
    const id = Number.parseInt(projectRef.slice("interior:".length), 10);
    if (Number.isInteger(id)) {
      // id_projects has a deliberately small legacy status vocabulary. Keep
      // pipeline lifecycle details in creative_render_sessions and expose the
      // closest customer-facing interior status without violating its check.
      const interiorStatus =
        status === "planning" || status === "preview_generating" ||
        status === "final_generating" || status === "quality_check"
          ? "analyzing"
          : status === "preview_ready"
            ? "outputs_ready"
            : status === "recompose_required"
              ? "revision_requested"
              : status === "failed"
                ? "revision_requested"
                : status === "waiting_client_review"
                  ? "outputs_ready"
                  : status;
      await db
        .update(idProjectsTable)
        .set({ status: interiorStatus, updatedAt: new Date() })
        .where(and(
          eq(idProjectsTable.id, id),
          // Legacy interior generation must not overwrite active pipeline
          // statuses after the preview workflow has taken ownership.
          sql`status NOT IN ('analyzing', 'outputs_ready', 'revision_requested', 'completed') OR ${interiorStatus} IN ('analyzing', 'outputs_ready', 'revision_requested', 'completed')`,
        ));
    }
    return;
  }

  await db
    .update(creativeProjectsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(creativeProjectsTable.projectId, projectRef));
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getAgentBySlug(slug: string) {
  const { aiAgentsTable, aiModelsTable, aiProvidersTable } = await import("@workspace/db");
  const [agent] = await db.select().from(aiAgentsTable).where(eq(aiAgentsTable.slug, slug));
  if (!agent?.modelId || !agent.providerId) return null;
  const [model] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.id, agent.modelId));
  const [provider] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, agent.providerId));
  if (!model || !provider) return null;
  return { agent, model, provider };
}

// ── Replicate image generation (shared with imageDesignerService) ─────────────

async function generateReplicateImage(
  modelId: string,
  input: { prompt: string; negativePrompt?: string; aspectRatio?: string; outputQuality?: number },
  apiKey: string,
  timeoutMs: number,
): Promise<{ imageUrl: string; latencyMs: number }> {
  const startTime = Date.now();

  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${modelId}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: input.prompt,
          aspect_ratio: input.aspectRatio ?? "1:1",
          output_format: "webp",
          output_quality: input.outputQuality ?? 80,
          num_outputs: 1,
          ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
        },
      }),
    },
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Replicate create error ${createRes.status}: ${errText}`);
  }

  const prediction = (await createRes.json()) as {
    id: string; status: string; output?: string[]; error?: string;
    urls?: { get?: string };
  };

  if (prediction.status === "succeeded" && Array.isArray(prediction.output)) {
    const url = prediction.output[0];
    if (url) return { imageUrl: url, latencyMs: Date.now() - startTime };
  }
  if (prediction.status === "failed") {
    throw new Error(`Replicate prediction failed: ${prediction.error ?? "unknown"}`);
  }

  const pollUrl = prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`;
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const pollRes = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!pollRes.ok) continue;
    const result = (await pollRes.json()) as { status: string; output?: string[]; error?: string };
    if (result.status === "succeeded") {
      const url = Array.isArray(result.output) ? result.output[0] : undefined;
      if (!url) throw new Error("Replicate returned no image URLs");
      return { imageUrl: url, latencyMs: Date.now() - startTime };
    }
    if (result.status === "failed") throw new Error(`Replicate prediction failed: ${result.error ?? "unknown"}`);
  }
  throw new Error(`Replicate timed out after ${timeoutMs}ms`);
}

// ── Persist image to Supabase Storage ─────────────────────────────────────────

async function persistImage(
  url: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const { isSupabaseStorageAvailable, uploadToSupabase } = await import("../lib/supabaseStorage.js");
    if (!isSupabaseStorageAvailable()) return null;
    const raw = await fetch(url);
    if (!raw.ok) return null;
    const buf = Buffer.from(await raw.arrayBuffer());
    const ct = raw.headers.get("content-type") || "image/webp";
    return await uploadToSupabase(storagePath, buf, ct);
  } catch {
    return null;
  }
}

/**
 * Provider-backed final render primitive used by the Interior Design
 * rendering pipeline. It deliberately keeps the Replicate client and storage
 * persistence in this existing service instead of introducing a second
 * provider or storage abstraction.
 */
export async function generatePhotorealisticInteriorImage(input: {
  projectUuid: string;
  sessionId: number;
  variantIndex: number;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ imageUrl: string; storagePath: string; model: string; latencyMs: number }> {
  const apiKey = getProviderApiKey("replicate");
  if (!apiKey) throw new Error("Replicate provider is not configured");

  const model = input.model ?? FLUX_DEV;
  const result = await generateReplicateImage(
    model,
    {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      aspectRatio: input.aspectRatio ?? "16:9",
      outputQuality: 90,
    },
    apiKey,
    input.timeoutMs ?? 120_000,
  );

  const storagePath =
    `interior-renders/${input.projectUuid}/${input.sessionId}/` +
    `variant-${input.variantIndex}-${Date.now()}.webp`;
  const storedUrl = await persistImage(result.imageUrl, storagePath);
  if (!storedUrl) {
    throw new Error("Generated image could not be persisted to object storage");
  }

  return {
    imageUrl: storedUrl,
    storagePath,
    model,
    latencyMs: result.latencyMs,
  };
}

// ── Step: Generate preview prompts (LLM) ──────────────────────────────────────

interface PreviewPromptResult {
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  style: string;
  explanation: string; // AI rationale shown on concept card
  estimatedStyle: string;
  estimatedTemplate: string;
}

async function generatePreviewPrompts(
  brief: Record<string, unknown>,
  brandStrategy: Record<string, unknown>,
  creativeDirection: Record<string, unknown>,
  count: number,
  packageTier: string,
): Promise<PreviewPromptResult[]> {
  const agentCtx = await getAgentBySlug("image-prompt-generator");
  const systemPrompt = agentCtx
    ? ((agentCtx.agent.metadata as { systemPrompt?: string } | null)?.systemPrompt ?? "")
    : "You are an expert AI image prompt engineer. IMPORTANT: The 'prompt' and 'negativePrompt' fields must stay in English (required by image generation models). Write 'explanation', 'estimatedStyle', and 'estimatedTemplate' values in Bahasa Indonesia.";

  const userPrompt = `Generate ${count} DISTINCT preview concepts for a brand visual campaign.

BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

BRAND STRATEGY:
${JSON.stringify(brandStrategy, null, 2)}

CREATIVE DIRECTION:
${JSON.stringify(creativeDirection, null, 2)}

PACKAGE TIER: ${packageTier}

Each concept must explore a DIFFERENT design direction (different composition, style, mood, color palette).
These are PREVIEW concepts — they will be shown to the customer for selection before final rendering.

Return a JSON array with EXACTLY ${count} objects. Each object:
{
  "prompt": "detailed positive prompt 60–120 words — describe lighting, composition, mood, color, subject, environment",
  "negativePrompt": "comma-separated negatives: text, watermark, low quality, blurry, distorted",
  "aspectRatio": "1:1",
  "style": "photographic",
  "explanation": "2–3 sentences explaining the design rationale and why this direction suits the brand",
  "estimatedStyle": "Modern Minimalist",
  "estimatedTemplate": "Clean Grid Layout"
}

Valid aspectRatio: "1:1", "16:9", "9:16", "3:2"
Valid style: "photographic", "illustration", "3d", "abstract"

Make each variation genuinely distinct. Respond with ONLY the JSON array.`;

  let content = "";
  try {
    if (agentCtx) {
      const output = await executeAI({
        prompt: userPrompt,
        systemPrompt,
        model: agentCtx.model,
        provider: agentCtx.provider,
        temperature: 0.85,
        maxTokens: 2048,
      });
      content = output.content;
    }
  } catch {
    // fall through to fallback
  }

  // Parse JSON
  const raw = content.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]") + 1;
  const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd) : "";

  const brandName = String((brief as { brandName?: string }).brandName ?? "Brand");
  const businessType = String((brief as { businessType?: string }).businessType ?? "");
  const stylePreference = String((brief as { stylePreference?: string }).stylePreference ?? "modern");

  const styles = ["Modern Minimalist", "Bold & Vibrant", "Elegant Premium", "Dynamic Creative"];
  const templates = ["Clean Grid", "Hero Visual", "Brand Story", "Product Focus"];

  if (jsonStr) {
    try {
      const parsed: unknown[] = JSON.parse(jsonStr);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.slice(0, count).map((p: unknown, i) => {
        const obj = p as Record<string, string>;
        return {
          prompt: String(obj["prompt"] ?? `${brandName} brand visual, ${stylePreference} style, variation ${i + 1}`),
          negativePrompt: String(obj["negativePrompt"] ?? "text, watermark, low quality, blurry, distorted"),
          aspectRatio: String(obj["aspectRatio"] ?? "1:1"),
          style: String(obj["style"] ?? "photographic"),
          explanation: String(obj["explanation"] ?? `Concept ${i + 1}: ${stylePreference} direction for ${brandName}.`),
          estimatedStyle: String(obj["estimatedStyle"] ?? styles[i % styles.length]),
          estimatedTemplate: String(obj["estimatedTemplate"] ?? templates[i % templates.length]),
        };
      });
    } catch {
      // fall through to fallback
    }
  }

  // Fallback: generate deterministic prompts
  const fallbackStyles = [
    { style: "photographic", desc: "clean photographic", tone: "professional minimal" },
    { style: "illustration", desc: "bold illustrated", tone: "vibrant energetic" },
    { style: "3d", desc: "premium 3D rendered", tone: "elegant sophisticated" },
    { style: "abstract", desc: "abstract conceptual", tone: "creative dynamic" },
  ];
  return Array.from({ length: count }, (_, i) => {
    const fs = fallbackStyles[i % fallbackStyles.length];
    return {
      prompt: `${fs.desc} brand visual for ${brandName}, ${businessType} industry, ${stylePreference} aesthetic, ${fs.tone} mood, clean composition, high quality`,
      negativePrompt: "text, watermark, low quality, blurry, distorted, logo, nsfw",
      aspectRatio: "1:1",
      style: fs.style ?? "photographic",
      explanation: `Concept ${i + 1}: ${fs.tone} direction — ${fs.desc} approach suited for ${brandName}'s target market.`,
      estimatedStyle: styles[i % styles.length] ?? "Modern",
      estimatedTemplate: templates[i % templates.length] ?? "Grid",
    };
  });
}

// ── Step: AI prompt refinement after concept selection ─────────────────────────

async function refinePromptForFinal(
  selectedPrompt: string,
  selectedNegativePrompt: string,
  selectedAspectRatio: string,
  customerFeedback: string,
  brief: Record<string, unknown>,
): Promise<{ prompt: string; negativePrompt: string; aspectRatio: string }> {
  const fallback = {
    prompt: customerFeedback.trim()
      ? `${selectedPrompt}. Customer direction: ${customerFeedback.trim()}.`
      : selectedPrompt,
    negativePrompt: selectedNegativePrompt,
    aspectRatio: selectedAspectRatio,
  };

  if (!customerFeedback.trim()) return fallback;

  const agentCtx = await getAgentBySlug("image-prompt-generator");
  if (!agentCtx) return fallback;

  const userPrompt = `Refine this image prompt for final high-resolution rendering, incorporating the customer's feedback.

ORIGINAL PROMPT:
${selectedPrompt}

CUSTOMER FEEDBACK / DIRECTION:
${customerFeedback}

BRAND BRIEF CONTEXT:
Brand: ${(brief as { brandName?: string }).brandName ?? ""}
Style: ${(brief as { stylePreference?: string }).stylePreference ?? ""}

Instructions:
- Keep the brand identity and core concept intact
- Only adjust the parts the customer mentioned
- Optimize for high-quality final render (more detailed, more precise)
- Output 80–150 words for the refined prompt

Respond with ONLY valid JSON (no markdown):
{
  "prompt": "<refined prompt>",
  "negativePrompt": "<comma-separated negatives>",
  "aspectRatio": "${selectedAspectRatio}"
}`;

  try {
    const output = await executeAI({
      prompt: userPrompt,
      systemPrompt: "You are an expert image prompt engineer. Respond only with valid JSON. IMPORTANT: The 'prompt' and 'negativePrompt' fields must stay in English (required by image generation models). All other descriptive text must be in Bahasa Indonesia.",
      model: agentCtx.model,
      provider: agentCtx.provider,
      temperature: 0.5,
      maxTokens: 512,
    });
    const raw = output.content.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}") + 1;
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd)) as Record<string, string>;
    return {
      prompt: String(parsed["prompt"] ?? fallback.prompt),
      negativePrompt: String(parsed["negativePrompt"] ?? fallback.negativePrompt),
      aspectRatio: String(parsed["aspectRatio"] ?? fallback.aspectRatio),
    };
  } catch {
    return fallback;
  }
}

// ── Step: Final image QC ──────────────────────────────────────────────────────

async function reviewFinalImage(
  brief: Record<string, unknown>,
  prompt: string,
  imageUrl: string,
): Promise<{ score: number; notes: string; tokensUsed: number; latencyMs: number }> {
  const agentCtx = await getAgentBySlug("image-qc");
  if (!agentCtx) return { score: 0, notes: "image-qc agent not found; QC failed closed.", tokensUsed: 0, latencyMs: 0 };

  const systemPrompt = (agentCtx.agent.metadata as { systemPrompt?: string } | null)?.systemPrompt ?? "";
  const userPrompt = `Review this AI-generated final image for a brand campaign.

BRAND: ${(brief as { brandName?: string }).brandName ?? ""}
BUSINESS: ${(brief as { businessType?: string }).businessType ?? ""}
TARGET MARKET: ${(brief as { targetMarket?: string }).targetMarket ?? ""}
GOAL: ${(brief as { goal?: string }).goal ?? ""}

GENERATION PROMPT: ${prompt}

Score the image on: Brand Alignment (0–30), Visual Quality (0–25), Text/Legibility (0–25), Brand Safety (0–20).

Respond with ONLY valid JSON:
{
  "score": <integer 1-100>,
  "notes": "<2-3 sentences>",
  "brand_alignment": "<pass|warning|fail>",
  "visual_clarity": "<pass|warning|fail>",
  "text_legible": "<pass|warning|fail|not_applicable>",
  "brand_safety": "<pass|warning|fail>"
}`;

  const startTime = Date.now();
  try {
    const output = await executeAI({
      prompt: userPrompt,
      systemPrompt,
      model: agentCtx.model,
      provider: agentCtx.provider,
      temperature: 0.3,
      maxTokens: 1024,
      imageUrl,
    });
    const latencyMs = Date.now() - startTime;
    const raw = output.content.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}") + 1;
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd)) as Record<string, unknown>;
    return {
      score: Math.min(100, Math.max(1, parseInt(String(parsed["score"] ?? 70), 10))),
      notes: String(parsed["notes"] ?? ""),
      tokensUsed: output.tokensUsed,
      latencyMs,
    };
  } catch {
    return { score: 0, notes: "QC agent call failed; QC failed closed.", tokensUsed: 0, latencyMs: 0 };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a render session and kick off preview generation in the background. */
export async function startPreviewSession(
  projectUuid: string,
  opts: {
    packageTier?: "standard" | "premium" | "enterprise";
    previewCount?: number;
    requestedFinalCount?: number;
  } = {},
): Promise<{ sessionId: number; message: string }> {
  const { packageTier = "standard", previewCount = 4, requestedFinalCount = 1 } = opts;

  const source = await loadPipelineSourceContext(projectUuid);
  if (!source) throw new Error(`Project ${projectUuid} not found or has no brief`);

  // Create the session
  const [session] = await db
    .insert(creativeRenderSessionsTable)
    .values({
      projectId: projectUuid,
      sessionStatus: "planning",
      packageTier,
      previewCount,
      requestedFinalCount,
      metadata: { startedAt: new Date().toISOString() },
    })
    .returning();

  await logAudit("preview-pipeline", "session_created", projectUuid, "creative_render_session", "success", {
    sessionId: session.id, packageTier, previewCount,
  });

  // Update the owning domain through the namespaced source reference.
  await updatePipelineSourceStatus(projectUuid, "planning");

  // Fire preview generation in background
  runPreviewGeneration(session.id, projectUuid, source.numericProjectId).catch(async (err) => {
    console.error(`[preview-pipeline] Preview generation failed for session ${session.id}:`, err);
    await db
      .update(creativeRenderSessionsTable)
      .set({ sessionStatus: "failed", updatedAt: new Date() })
      .where(eq(creativeRenderSessionsTable.id, session.id));
    await logAudit("preview-pipeline", "preview_generation_failed", projectUuid, "creative_render_session", "failure", {
      sessionId: session.id, error: String(err),
    });
  });

  return { sessionId: session.id, message: `Preview generation started for ${previewCount} concepts` };
}

/** Background: generate preview concept images (cheap, no QC). */
export async function runPreviewGeneration(
  sessionId: number,
  projectUuid: string,
  projectDbId: number,
): Promise<void> {
  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.id, sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Mark as generating
  await db
    .update(creativeRenderSessionsTable)
    .set({ sessionStatus: "preview_generating", updatedAt: new Date() })
    .where(eq(creativeRenderSessionsTable.id, sessionId));

  await updatePipelineSourceStatus(projectUuid, "preview_generating");

  // Load the source through the namespaced reference. Interior projects use
  // id_projects/id_briefs and never query creative_projects.
  const source = await loadPipelineSourceContext(projectUuid, projectDbId);
  if (!source) throw new Error(`Source ${projectUuid} not found`);
  const { brief, brandStrategy, creativeDirection } = source;

  const previewCount = session.previewCount ?? 4;
  const packageTier = (session.packageTier ?? "standard") as keyof typeof TIER_CONFIG;
  const guardrails = await readGuardrails();
  const replicateKey = getProviderApiKey("replicate");

  // Generate prompts via LLM
  let previewPrompts: PreviewPromptResult[] = [];
  try {
    previewPrompts = await generatePreviewPrompts(brief, brandStrategy, creativeDirection, previewCount, packageTier);
  } catch (err) {
    console.error(`[preview-pipeline] Prompt generation failed:`, err);
    previewPrompts = Array.from({ length: previewCount }, (_, i) => ({
      prompt: `Professional brand visual for ${brief.brandName ?? "brand"}, variation ${i + 1}, modern style`,
      negativePrompt: "text, watermark, low quality, blurry, distorted, nsfw",
      aspectRatio: "1:1",
      style: "photographic",
      explanation: `Concept ${i + 1}: Modern clean direction for ${brief.brandName}.`,
      estimatedStyle: "Modern",
      estimatedTemplate: "Clean Grid",
    }));
  }

  const tierCfg = TIER_CONFIG[packageTier] ?? TIER_CONFIG.standard;

  // Insert placeholder rows
  const assetIds: number[] = [];
  for (let i = 0; i < previewPrompts.length; i++) {
    const p = previewPrompts[i];
    const [row] = await db
      .insert(creativeAiAssetsTable)
      .values({
        projectId: projectUuid,
        provider: "replicate",
        model: PREVIEW_CONFIG.model,
        assetType: "image",
        prompt: p.prompt,
        negativePrompt: p.negativePrompt,
        aspectRatio: p.aspectRatio,
        status: replicateKey ? "generating" : "failed",
        renderStage: "preview",
        renderSessionId: sessionId,
        conceptIndex: i + 1,
        aiExplanation: p.explanation,
        estimatedFinalCostUsd: String(PREVIEW_CONFIG.estimatedFinalCostUsd[packageTier] ?? 0.003),
        estimatedRenderTimeMs: PREVIEW_CONFIG.estimatedRenderTimeMs[packageTier] ?? 15000,
        metadata: {
          style: p.style,
          estimatedStyle: p.estimatedStyle,
          estimatedTemplate: p.estimatedTemplate,
          packageTier,
        },
        cost: "0",
        latencyMs: 0,
      } as any)
      .returning({ id: creativeAiAssetsTable.id });
    assetIds.push(row.id);
  }

  if (!replicateKey) {
    await db
      .update(creativeRenderSessionsTable)
      .set({ sessionStatus: "preview_ready", updatedAt: new Date() })
      .where(eq(creativeRenderSessionsTable.id, sessionId));
    return;
  }

  const timeoutMs = Math.min(guardrails.providerTimeoutMs, 120000);
  const MIN_INTER_REQUEST_MS = 10500;
  let lastRequestAt = 0;
  let totalPreviewCost = 0;

  for (let i = 0; i < previewPrompts.length; i++) {
    const p = previewPrompts[i];
    const assetId = assetIds[i];

    // Rate-limit between Replicate calls
    const waitMs = MIN_INTER_REQUEST_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    lastRequestAt = Date.now();

    let imageUrl: string | null = null;
    let imageLatency = 0;
    let imageStatus = "failed";
    let errorNote: string | null = null;

    try {
      const result = await generateReplicateImage(
        PREVIEW_CONFIG.model,
        { prompt: p.prompt, negativePrompt: p.negativePrompt, aspectRatio: p.aspectRatio, outputQuality: PREVIEW_CONFIG.outputQuality },
        replicateKey,
        timeoutMs,
      );
      imageUrl = result.imageUrl;
      imageLatency = result.latencyMs;
      imageStatus = "completed";
    } catch (err) {
      errorNote = `Preview generation failed: ${String(err)}`;
    }

    // Persist to Supabase Storage
    let finalImageUrl: string | null = imageUrl;
    if (imageUrl) {
      const storagePath = `creative-assets/${projectUuid}/previews/concept-${i + 1}-${Date.now()}.webp`;
      const persisted = await persistImage(imageUrl, storagePath);
      if (persisted) finalImageUrl = persisted;
    }

    const imageCost = imageStatus === "completed" ? PREVIEW_CONFIG.costPerImage : 0;
    totalPreviewCost += imageCost;

    await db
      .update(creativeAiAssetsTable)
      .set({
        imageUrl: finalImageUrl,
        status: imageStatus,
        cost: String(imageCost.toFixed(6)),
        latencyMs: imageLatency,
        qcNotes: errorNote,
      })
      .where(eq(creativeAiAssetsTable.id, assetId));

    await recordCost({
      projectId: projectUuid,
      agentSlug: "image-designer",
      provider: "replicate",
      model: PREVIEW_CONFIG.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: imageLatency,
      status: imageStatus === "completed" ? "success" : "failed",
    });
  }

  // Mark session as preview_ready
  await db
    .update(creativeRenderSessionsTable)
    .set({
      sessionStatus: "preview_ready",
      previewCostUsd: String(totalPreviewCost.toFixed(6)),
      totalCostUsd: String(totalPreviewCost.toFixed(6)),
      updatedAt: new Date(),
    })
    .where(eq(creativeRenderSessionsTable.id, sessionId));

  await updatePipelineSourceStatus(projectUuid, "preview_ready");

  await logAudit("preview-pipeline", "preview_ready", projectUuid, "creative_render_session", "success", {
    sessionId, previewCount: previewPrompts.length, totalPreviewCost,
  });
}

/** Customer selects a concept. Refines the prompt, marks session as concept_selected. */
export async function selectConcept(
  sessionId: number,
  conceptAssetId: number,
  feedback?: string,
): Promise<void> {
  const [session] = await db
    .select().from(creativeRenderSessionsTable).where(eq(creativeRenderSessionsTable.id, sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const [concept] = await db
    .select().from(creativeAiAssetsTable).where(eq(creativeAiAssetsTable.id, conceptAssetId));
  if (!concept || concept.renderSessionId !== sessionId || concept.renderStage !== "preview") {
    throw new Error(`Concept asset ${conceptAssetId} does not belong to this preview session`);
  }

  const source = await loadPipelineSourceContext(session.projectId);
  if (!source) throw new Error(`Source ${session.projectId} not found`);
  const { brief } = source;

  // AI prompt refinement
  let refinedPrompt = concept.prompt;
  let refinedNegativePrompt = concept.negativePrompt ?? "text, watermark, low quality, blurry, distorted";
  let refinedAspectRatio = concept.aspectRatio ?? "1:1";

  if (feedback?.trim()) {
    try {
      const refined = await refinePromptForFinal(
        concept.prompt,
        concept.negativePrompt ?? "",
        concept.aspectRatio ?? "1:1",
        feedback.trim(),
        brief,
      );
      refinedPrompt = refined.prompt;
      refinedNegativePrompt = refined.negativePrompt;
      refinedAspectRatio = refined.aspectRatio;
    } catch (err) {
      console.warn(`[preview-pipeline] Prompt refinement failed:`, err);
    }
  }

  // Store refined prompt back on the selected concept asset
  await db
    .update(creativeAiAssetsTable)
    .set({
      revisionNotes: feedback?.trim() ? `Refined for final: ${feedback.trim()}` : null,
      metadata: {
        ...(concept.metadata as object ?? {}),
        selectedForFinal: true,
        refinedPrompt,
        refinedNegativePrompt,
        refinedAspectRatio,
      },
    })
    .where(eq(creativeAiAssetsTable.id, conceptAssetId));

  // Update session
  await db
    .update(creativeRenderSessionsTable)
    .set({
      selectedConceptId: conceptAssetId,
      customerFeedback: feedback?.trim() ?? null,
      sessionStatus: "concept_selected",
      updatedAt: new Date(),
    })
    .where(eq(creativeRenderSessionsTable.id, sessionId));

  await updatePipelineSourceStatus(session.projectId, "waiting_client_review");

  await logAudit("preview-pipeline", "concept_selected", session.projectId, "creative_render_session", "success", {
    sessionId, conceptAssetId, hasFeedback: !!(feedback?.trim()),
  });
}

/** Start final high-quality generation after concept selection. */
export async function runFinalGeneration(
  sessionId: number,
  requestedCount?: number,
): Promise<void> {
  const [session] = await db
    .select().from(creativeRenderSessionsTable).where(eq(creativeRenderSessionsTable.id, sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (!session.selectedConceptId) throw new Error("No concept selected for this session");

  const finalCount = requestedCount ?? session.requestedFinalCount ?? 1;
  const packageTier = (session.packageTier ?? "standard") as keyof typeof TIER_CONFIG;
  const tierCfg = TIER_CONFIG[packageTier] ?? TIER_CONFIG.standard;
  const projectUuid = session.projectId;

  // Mark session + project as final_generating
  await db
    .update(creativeRenderSessionsTable)
    .set({ sessionStatus: "final_generating", requestedFinalCount: finalCount, updatedAt: new Date() })
    .where(eq(creativeRenderSessionsTable.id, sessionId));

  await updatePipelineSourceStatus(projectUuid, "final_generating");

  // Load selected concept for prompt
  const [selectedConcept] = await db
    .select().from(creativeAiAssetsTable).where(eq(creativeAiAssetsTable.id, session.selectedConceptId));
  if (
    !selectedConcept ||
    selectedConcept.renderSessionId !== sessionId ||
    selectedConcept.renderStage !== "preview"
  ) {
    throw new Error("Selected concept asset does not belong to this session");
  }

  const refinedData = (selectedConcept.metadata as Record<string, unknown> | null) ?? {};
  const prompt = String(refinedData["refinedPrompt"] ?? selectedConcept.prompt);
  const negativePrompt = String(refinedData["refinedNegativePrompt"] ?? (selectedConcept.negativePrompt ?? "text, watermark, low quality, blurry, distorted"));
  const aspectRatio = String(refinedData["refinedAspectRatio"] ?? (selectedConcept.aspectRatio ?? "1:1"));

  const source = await loadPipelineSourceContext(projectUuid);
  if (!source) throw new Error(`Source ${projectUuid} not found`);
  const { brief } = source;
  const sessionMetadata = metadataObject(session.metadata);
  const finalAttempt = Number(sessionMetadata["finalAttempt"] ?? 1);

  const guardrails = await readGuardrails();
  const replicateKey = getProviderApiKey("replicate");
  const timeoutMs = Math.min(guardrails.providerTimeoutMs, 120000);

  // Insert final asset placeholders
  const finalAssetIds: number[] = [];
  for (let i = 0; i < finalCount; i++) {
    const [row] = await db
      .insert(creativeAiAssetsTable)
      .values({
        projectId: projectUuid,
        provider: "replicate",
        model: tierCfg.model,
        assetType: "image",
        prompt,
        negativePrompt,
        aspectRatio,
        status: replicateKey ? "generating" : "failed",
        renderStage: "final",
        renderSessionId: sessionId,
        conceptIndex: i + 1,
        aiExplanation: selectedConcept.aiExplanation,
        metadata: {
          packageTier,
          fromConceptId: session.selectedConceptId,
          finalVariationIndex: i + 1,
          finalAttempt,
        },
        cost: "0",
        latencyMs: 0,
      } as any)
      .returning({ id: creativeAiAssetsTable.id });
    finalAssetIds.push(row.id);
  }

  if (!replicateKey) {
    await db
      .update(creativeRenderSessionsTable)
      .set({ sessionStatus: "failed", updatedAt: new Date() })
      .where(eq(creativeRenderSessionsTable.id, sessionId));
    await updatePipelineSourceStatus(projectUuid, "failed");
    return;
  }

  const MIN_INTER_REQUEST_MS = 10500;
  let lastRequestAt = 0;
  let totalFinalCost = 0;
  let totalQcCost = 0;

  for (let i = 0; i < finalCount; i++) {
    const assetId = finalAssetIds[i];

    // Rate-limit
    const waitMs = MIN_INTER_REQUEST_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    lastRequestAt = Date.now();

    let imageUrl: string | null = null;
    let imageLatency = 0;
    let imageStatus = "failed";
    let errorNote: string | null = null;

    try {
      const result = await generateReplicateImage(
        tierCfg.model,
        { prompt, negativePrompt, aspectRatio, outputQuality: tierCfg.outputQuality },
        replicateKey,
        timeoutMs,
      );
      imageUrl = result.imageUrl;
      imageLatency = result.latencyMs;
      imageStatus = "completed";
    } catch (err) {
      errorNote = `Final generation failed: ${String(err)}`;
    }

    // Persist
    let finalImageUrl: string | null = imageUrl;
    if (imageUrl) {
      const storagePath = `creative-assets/${projectUuid}/final/${packageTier}-${i + 1}-${Date.now()}.webp`;
      const persisted = await persistImage(imageUrl, storagePath);
      if (persisted) finalImageUrl = persisted;
    }

    const imageCost = imageStatus === "completed" ? tierCfg.costPerImage : 0;
    totalFinalCost += imageCost;

    // QC — runs ONLY on final images
    let qcScore: number | null = null;
    let qcNotes: string | null = null;

    if (imageStatus === "completed" && finalImageUrl) {
      await updatePipelineSourceStatus(projectUuid, "quality_check");
      await db
        .update(creativeRenderSessionsTable)
        .set({ sessionStatus: "quality_check", updatedAt: new Date() })
        .where(eq(creativeRenderSessionsTable.id, sessionId));

      const qc = await reviewFinalImage(brief, prompt, finalImageUrl);
      qcScore = qc.score;
      qcNotes = qc.notes;

      if (qc.tokensUsed > 0) {
        const qcCostApprox = 0.001;
        totalQcCost += qcCostApprox;
        await recordCost({
          projectId: projectUuid,
          agentSlug: "image-qc",
          provider: "openai",
          model: "gpt-4o",
          inputTokens: Math.floor(qc.tokensUsed * 0.65),
          outputTokens: Math.floor(qc.tokensUsed * 0.35),
          latencyMs: qc.latencyMs,
          status: "success",
        });
      }
    }

    await db
      .update(creativeAiAssetsTable)
      .set({
        imageUrl: finalImageUrl,
        status: imageStatus === "completed"
          ? (qcScore !== null && qcScore >= FINAL_QC_THRESHOLD ? "completed" : "needs_revision")
          : "failed",
        qcScore,
        qcNotes: qcNotes ?? errorNote,
        cost: String(imageCost.toFixed(6)),
        latencyMs: imageLatency,
      })
      .where(eq(creativeAiAssetsTable.id, assetId));

    await recordCost({
      projectId: projectUuid,
      agentSlug: "image-designer",
      provider: "replicate",
      model: tierCfg.model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: imageLatency,
      status: imageStatus === "completed" ? "success" : "failed",
    });
  }

  // Finalise session
  const prevPreviewCost = parseFloat(String(session.previewCostUsd ?? "0"));
  const totalCost = prevPreviewCost + totalFinalCost + totalQcCost;

  const latestFinalAssets = await db
    .select({
      status: creativeAiAssetsTable.status,
      qcScore: creativeAiAssetsTable.qcScore,
      metadata: creativeAiAssetsTable.metadata,
    })
    .from(creativeAiAssetsTable)
    .where(and(
      eq(creativeAiAssetsTable.renderSessionId, sessionId),
      eq(creativeAiAssetsTable.renderStage, "final"),
    ));
  const attemptAssets = latestFinalAssets.filter((asset) =>
    Number(metadataObject(asset.metadata)["finalAttempt"] ?? 1) === finalAttempt,
  );
  const allLatestPassed = attemptAssets.length === finalCount &&
    attemptAssets.every((asset) => asset.status === "completed" && (asset.qcScore ?? 0) >= FINAL_QC_THRESHOLD);
  const nextSessionStatus = allLatestPassed ? "completed" : "recompose_required";

  await db
    .update(creativeRenderSessionsTable)
    .set({
      sessionStatus: nextSessionStatus,
      finalCostUsd: String(totalFinalCost.toFixed(6)),
      qcCostUsd: String(totalQcCost.toFixed(6)),
      totalCostUsd: String(totalCost.toFixed(6)),
      updatedAt: new Date(),
    })
    .where(eq(creativeRenderSessionsTable.id, sessionId));

  await updatePipelineSourceStatus(projectUuid, nextSessionStatus === "completed" ? "completed" : "recompose_required");

  await logAudit("preview-pipeline", nextSessionStatus === "completed" ? "final_completed" : "final_recompose_required", projectUuid, "creative_render_session", nextSessionStatus === "completed" ? "success" : "warning", {
    sessionId, finalCount, finalAttempt, totalFinalCost, totalQcCost, packageTier, qcThreshold: FINAL_QC_THRESHOLD,
  });
}

/** Generate additional preview concepts (customer asks for more options). */
export async function generateMorePreviews(
  sessionId: number,
  count = 4,
): Promise<void> {
  const [session] = await db
    .select().from(creativeRenderSessionsTable).where(eq(creativeRenderSessionsTable.id, sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // How many previews do we already have?
  const existingPreviews = await db
    .select({ id: creativeAiAssetsTable.id })
    .from(creativeAiAssetsTable)
    .where(and(
      eq(creativeAiAssetsTable.renderSessionId, sessionId),
      eq(creativeAiAssetsTable.renderStage, "preview"),
    ));

  const startIndex = existingPreviews.length;

  await db
    .update(creativeRenderSessionsTable)
    .set({
      sessionStatus: "preview_generating",
      previewCount: startIndex + count,
      updatedAt: new Date(),
    })
    .where(eq(creativeRenderSessionsTable.id, sessionId));

  const source = await loadPipelineSourceContext(session.projectId);
  if (!source) throw new Error("Project not found for session");

  await runPreviewGeneration(sessionId, session.projectId, source.numericProjectId);
}
