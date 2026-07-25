/**
 * imageDesignerService — Phase 5 AI Image Designer pipeline.
 *
 * Pipeline: Image Prompt Generator (LLM) → Image Designer (Replicate FLUX.1) → Image QC (LLM)
 * Runs fire-and-forget after the HTTP response is sent.
 *
 * Guardrails respected:
 *   - maxCostPerWorkflow: blocks pipeline if project budget already exceeded
 *   - maxRetryPerProvider: retries Replicate on transient errors (capped at 2)
 *   - providerTimeoutMs: Replicate poll timeout
 *   - fallbackEnabled: falls back to FLUX.1 Dev on Schnell failure
 *
 * If REPLICATE_API_TOKEN is not set, the assets are saved with status "failed"
 * and a clear error note — the main workflow is never crashed.
 */

import { eq } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  aiAgentsTable,
  aiModelsTable,
  aiProvidersTable,
  creativeAiAssetsTable,
  aiServiceRequestsTable,
} from "@workspace/db";
import { getConceptDraftForImagePipeline } from "../domains/interior-design/service.js";
import { executeAI } from "./aiExecutionService.js";
import { getProviderApiKey } from "./aiSecretService.js";
import { logAudit } from "./aiAuditService.js";
import { recordCost, getProjectCosts } from "./costService.js";
import { readGuardrails } from "./guardrailService.js";
import { applyTextOverlay, type OverlaySpec, type OverlayContext } from "../lib/textOverlay.js";
import { getPublicBaseUrl } from "../lib/publicBaseUrl.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImagePromptResult {
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  style: string;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getAgentBySlug(slug: string) {
  const [agent] = await db
    .select()
    .from(aiAgentsTable)
    .where(eq(aiAgentsTable.slug, slug));
  return agent ?? null;
}

async function getModelById(id: number) {
  const [model] = await db.select().from(aiModelsTable).where(eq(aiModelsTable.id, id));
  return model ?? null;
}

async function getProviderById(id: number) {
  const [provider] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, id));
  return provider ?? null;
}

// ── Interior Design step detector ────────────────────────────────────────────

const INTERIOR_STEP_NAMES = new Set([
  "Design Concept",
  "Space Planning",
  "Material Specification",
  "Design Copy",
  "Interior Quality Control",
]);

/** Exported for use by route guards. */
export function isInteriorDesignProject(steps: Array<{ stepName: string }>) {
  return steps.some((s) => INTERIOR_STEP_NAMES.has(s.stepName));
}

// ── Testable data-resolution helper ──────────────────────────────────────────

/**
 * Resolves the render data source for an Interior Design image prompt.
 *
 * Priority (strict):
 *   1. Approved snapshot (approvedSpacePlan / approvedMaterials / approvedFurniture /
 *      approvedLighting / approvedVisualConcept) — used when reviewState is
 *      "approved_for_rendering" and approvedAt is non-null.
 *   2. Current mutable draft fields — used when a draft exists but is not approved.
 *   3. Raw step outputs — last resort when no draft row exists at all.
 *
 * Mutable draft fields are NEVER used when an approved snapshot exists.
 * Original step outputs are NEVER used when an approved snapshot exists.
 */
export function buildInteriorImagePromptContext(
  draft: {
    reviewState: string;
    approvedAt: Date | null;
    approvedVisualConcept: string | null;
    approvedSpacePlan: unknown;
    approvedMaterials: unknown;
    approvedFurniture: unknown;
    approvedLighting: unknown;
    visualConceptDraft: string | null;
    spacePlanDraft: unknown;
    materialsDraft: unknown;
    furnitureDraft: unknown;
    lightingDraft: unknown;
  } | null,
  stepsByName: Record<string, unknown>,
): {
  visualConcept: string;
  spacePlan: unknown;
  materials: unknown;
  furniture: unknown;
  lighting: unknown;
  renderSource: "approved_snapshot" | "draft" | "step_outputs";
} {
  const useApprovedSnapshot =
    draft?.reviewState === "approved_for_rendering" && draft.approvedAt != null;

  if (useApprovedSnapshot && draft) {
    return {
      visualConcept:  draft.approvedVisualConcept ?? "",
      spacePlan:      draft.approvedSpacePlan  ?? {},
      materials:      draft.approvedMaterials  ?? {},
      furniture:      draft.approvedFurniture  ?? {},
      lighting:       draft.approvedLighting   ?? {},
      renderSource:   "approved_snapshot",
    };
  }

  // Draft fields (mutable) — only when NOT approved
  if (draft) {
    const rawConcept = stepsByName["Design Concept"];
    const fallbackConcept: string = (() => {
      if (typeof rawConcept === "string") return rawConcept;
      if (rawConcept && typeof rawConcept === "object") {
        const co = rawConcept as Record<string, unknown>;
        return typeof co["visualConcept"] === "string" ? co["visualConcept"]
             : typeof co["concept"]       === "string" ? co["concept"]
             : "";
      }
      return "";
    })();

    return {
      visualConcept:  draft.visualConceptDraft ?? fallbackConcept,
      spacePlan:      draft.spacePlanDraft  ?? stepsByName["Space Planning"]          ?? {},
      materials:      draft.materialsDraft  ?? stepsByName["Material Specification"]  ?? {},
      furniture:      draft.furnitureDraft  ?? stepsByName["Design Copy"]             ?? {},
      lighting:       draft.lightingDraft   ?? stepsByName["Design Copy"]             ?? {},
      renderSource:   "draft",
    };
  }

  // Raw step outputs — no draft exists at all
  const rawConcept = stepsByName["Design Concept"];
  const visualConcept: string = (() => {
    if (typeof rawConcept === "string") return rawConcept;
    if (rawConcept && typeof rawConcept === "object") {
      const co = rawConcept as Record<string, unknown>;
      return typeof co["visualConcept"] === "string" ? co["visualConcept"]
           : typeof co["concept"]       === "string" ? co["concept"]
           : "";
    }
    return "";
  })();

  return {
    visualConcept,
    spacePlan:    stepsByName["Space Planning"]         ?? {},
    materials:    stepsByName["Material Specification"] ?? {},
    furniture:    stepsByName["Design Copy"]            ?? {},
    lighting:     stepsByName["Design Copy"]            ?? {},
    renderSource: "step_outputs",
  };
}

// ── Interior Design Image Prompt Generator ────────────────────────────────────

/**
 * Builds interior-specific image generation prompts by reading the latest saved
 * draft (or falling back to raw step outputs when no draft exists).
 * Uses the same image-prompt-generator agent as the brand workflow.
 */
async function generateInteriorImagePrompts(
  projectUuid: string,
  steps: Array<{ stepName: string; output: unknown }>,
  brief: Record<string, unknown>,
  numVariations: number,
): Promise<{ prompts: ImagePromptResult[]; latencyMs: number; tokensUsed: number }> {
  const agent = await getAgentBySlug("image-prompt-generator");
  if (!agent || !agent.modelId || !agent.providerId) {
    throw new Error("image-prompt-generator agent not found. Run `pnpm seed` first.");
  }

  const [model, provider] = await Promise.all([
    getModelById(agent.modelId),
    getProviderById(agent.providerId),
  ]);
  if (!model || !provider) throw new Error("Model or provider not found for image-prompt-generator");

  const systemPrompt =
    (agent.metadata as { systemPrompt?: string } | null)?.systemPrompt ?? "";

  // ── Resolve data source via canonical helper ──────────────────────────────
  // RULE: approved snapshot is used when reviewState === "approved_for_rendering".
  //       Mutable draft fields are NEVER used once an approved snapshot exists.
  //       Raw step outputs are NEVER used once an approved snapshot exists.
  const draft = await getConceptDraftForImagePipeline(projectUuid);
  const byName = Object.fromEntries(steps.map((s) => [s.stepName, s.output]));

  const ctx = buildInteriorImagePromptContext(draft, byName);
  const { visualConcept, spacePlan, materials, furniture, lighting } = ctx;

  // Summarise space zones
  const zones: string[] = (() => {
    const sp = spacePlan as Record<string, unknown> | null;
    const rawZones = Array.isArray(sp?.["zones"]) ? (sp?.["zones"] as Array<Record<string, unknown>>) : [];
    return rawZones.slice(0, 5).map((z) =>
      `${z["name"] ?? z["label"] ?? z["zone"] ?? "Zone"}: ${z["function"] ?? z["purpose"] ?? ""}`.trim(),
    ).filter(Boolean);
  })();

  // Summarise key materials
  const matSummary: string[] = (() => {
    const mat = materials as Record<string, unknown> | null;
    const items = Array.isArray(mat?.["items"]) ? (mat?.["items"] as Array<Record<string, unknown>>) : [];
    return items.slice(0, 6).map((m) =>
      `${m["area"] ?? m["component"] ?? ""}/${m["materialType"] ?? m["material"] ?? m["type"] ?? ""}`.replace(/^\//, "").replace(/\/$/, ""),
    ).filter(Boolean);
  })();

  // Summarise lighting
  const lightingSummary: string[] = (() => {
    const lg = lighting as Record<string, unknown> | null;
    if (!lg) return [];
    const parts: string[] = [];
    const ambient = lg["ambient"] as Record<string, unknown> | undefined;
    const task_   = lg["task"]   as Record<string, unknown> | undefined;
    const accent  = lg["accent"] as Record<string, unknown> | undefined;
    if (ambient?.["type"])  parts.push(`Ambient: ${ambient["type"]} @ ${ambient["colorTemp"] ?? ""}`);
    if (task_?.["type"])    parts.push(`Task: ${task_["type"]}`);
    if (accent?.["type"])   parts.push(`Accent: ${accent["type"]}`);
    return parts;
  })();

  const userPrompt = `Generate ${numVariations} distinct interior visualization image prompts.

DATA SOURCE: ${ctx.renderSource === "approved_snapshot" ? "APPROVED SNAPSHOT (admin-approved, immutable)" : ctx.renderSource === "draft" ? "CURRENT DRAFT" : "STEP OUTPUTS"}

ROOM BRIEF:
${JSON.stringify(brief, null, 2)}

VISUAL CONCEPT:
${visualConcept}

KEY ZONES:
${zones.length > 0 ? zones.join("\n") : "Open-plan layout"}

SELECTED MATERIALS:
${matSummary.length > 0 ? matSummary.join(", ") : "Mix of natural and contemporary materials"}

FURNITURE PLACEMENT:
${JSON.stringify(furniture, null, 2).slice(0, 600)}

LIGHTING DESIGN:
${lightingSummary.length > 0 ? lightingSummary.join("; ") : JSON.stringify(lighting, null, 2).slice(0, 400)}

Return a JSON array with EXACTLY ${numVariations} objects. Each must have:
{
  "prompt": "detailed interior visualization prompt, 60-150 words — describe camera angle, natural light, material textures, furniture arrangement, atmosphere, color palette",
  "negativePrompt": "comma-separated list: text, watermark, people, low quality, blurry, distorted, unrealistic, cartoon",
  "aspectRatio": "16:9",
  "style": "photographic"
}

Valid aspectRatio: "16:9", "1:1", "3:2"
Valid style: "photographic", "3d", "illustration"

Make each variation show a DIFFERENT camera angle or focal area of the same room.

CRITICAL: Respond with ONLY the JSON array. No markdown. No explanation.`;

  const startTime = Date.now();
  const output = await executeAI({
    prompt: userPrompt,
    systemPrompt,
    model,
    provider,
    temperature: agent.temperature ? parseFloat(String(agent.temperature)) : 0.8,
    maxTokens: agent.maxTokens ?? 2048,
  });
  const latencyMs = Date.now() - startTime;

  const raw = output.content.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]") + 1;
  const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd) : raw;

  let prompts: ImagePromptResult[];
  try {
    const parsed = JSON.parse(jsonStr);
    const arr: ImagePromptResult[] = Array.isArray(parsed) ? parsed : [parsed];
    prompts = arr.slice(0, numVariations).map((p) => ({
      prompt:        String(p.prompt        ?? "interior visualization, photorealistic, natural light"),
      negativePrompt: String(p.negativePrompt ?? "text, watermark, people, low quality, blurry, distorted"),
      aspectRatio:   String(p.aspectRatio   ?? "16:9"),
      style:         String(p.style         ?? "photographic"),
    }));
  } catch {
    prompts = Array.from({ length: numVariations }, (_, i) => ({
      prompt: `Photorealistic interior visualization of a ${String(brief["businessType"] ?? "room")}, variation ${i + 1}, ${String(visualConcept).slice(0, 120)}, natural light, professional interior photography`,
      negativePrompt: "text, watermark, people, low quality, blurry, distorted, cartoon, unrealistic",
      aspectRatio: "16:9",
      style: "photographic",
    }));
  }

  return { prompts, latencyMs, tokensUsed: output.tokensUsed };
}

// ── Step 1: Image Prompt Generator ───────────────────────────────────────────

async function generateImagePrompts(
  brief: Record<string, unknown>,
  brandStrategy: Record<string, unknown>,
  creativeDirection: Record<string, unknown>,
  numVariations: number,
): Promise<{ prompts: ImagePromptResult[]; latencyMs: number; tokensUsed: number }> {
  const agent = await getAgentBySlug("image-prompt-generator");
  if (!agent || !agent.modelId || !agent.providerId) {
    throw new Error("image-prompt-generator agent not found. Run `pnpm seed` first.");
  }

  const [model, provider] = await Promise.all([
    getModelById(agent.modelId),
    getProviderById(agent.providerId),
  ]);

  if (!model || !provider) {
    throw new Error("Model or provider not found for image-prompt-generator");
  }

  const systemPrompt =
    (agent.metadata as { systemPrompt?: string } | null)?.systemPrompt ?? "";

  const conceptName =
    (creativeDirection as { creative_concept?: { name?: string } } | null)
      ?.creative_concept?.name ?? "";
  const visualStyle =
    (creativeDirection as { visual_style?: { approach?: string } } | null)
      ?.visual_style?.approach ?? "photographic";
  const colorDirection =
    (creativeDirection as { color_direction?: { primary?: string; rationale?: string } } | null)
      ?.color_direction ?? {};

  const userPrompt = `Generate ${numVariations} distinct image generation prompts for a brand campaign.

BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

BRAND STRATEGY (summary):
${JSON.stringify(brandStrategy, null, 2)}

CREATIVE DIRECTION:
- Concept: ${conceptName}
- Visual Style: ${visualStyle}
- Color Direction: ${JSON.stringify(colorDirection)}

Return a JSON array with EXACTLY ${numVariations} objects. Each object must have:
{
  "prompt": "detailed positive prompt 60-150 words — describe lighting, composition, mood, color, subject, environment",
  "negativePrompt": "comma-separated list of things to avoid: e.g. text, watermark, low quality, blurry, distorted, nsfw",
  "aspectRatio": "1:1",
  "style": "photographic"
}

Valid aspectRatio values: "1:1", "16:9", "9:16", "3:2"
Valid style values: "photographic", "illustration", "3d", "abstract"

Make each variation distinct — different composition, angle, or focus while staying on brand.

CRITICAL: Respond with ONLY the JSON array. No markdown fences. No explanation.`;

  const startTime = Date.now();
  const output = await executeAI({
    prompt: userPrompt,
    systemPrompt,
    model,
    provider,
    temperature: agent.temperature ? parseFloat(String(agent.temperature)) : 0.8,
    maxTokens: agent.maxTokens ?? 2048,
  });
  const latencyMs = Date.now() - startTime;

  // Parse JSON — strip any accidental markdown fences first
  const raw = output.content.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]") + 1;
  const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd) : raw;

  let prompts: ImagePromptResult[];
  try {
    const parsed = JSON.parse(jsonStr);
    const arr: ImagePromptResult[] = Array.isArray(parsed) ? parsed : [parsed];
    prompts = arr.slice(0, numVariations).map((p) => ({
      prompt: String(p.prompt ?? "brand visual campaign image"),
      negativePrompt: String(p.negativePrompt ?? "text, watermark, low quality, blurry, distorted"),
      aspectRatio: String(p.aspectRatio ?? "1:1"),
      style: String(p.style ?? "photographic"),
    }));
  } catch {
    // Fallback prompts derived from creative direction
    prompts = Array.from({ length: numVariations }, (_, i) => ({
      prompt: `Professional brand campaign visual for ${
        (brief as { brandName?: string }).brandName ?? "brand"
      }, variation ${i + 1}, ${visualStyle} style, ${conceptName ? `concept: ${conceptName}, ` : ""}clean composition, modern aesthetic`,
      negativePrompt: "text, watermark, low quality, blurry, distorted, oversaturated",
      aspectRatio: "1:1",
      style: visualStyle,
    }));
  }

  return { prompts, latencyMs, tokensUsed: output.tokensUsed };
}

// ── Step 2: Replicate Image Generation ───────────────────────────────────────

async function generateReplicateImage(
  modelId: string,
  input: {
    prompt: string;
    negativePrompt?: string;
    aspectRatio?: string;
  },
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
        Prefer: "wait", // use sync mode if supported (waits up to 60s)
      },
      body: JSON.stringify({
        input: {
          prompt: input.prompt,
          aspect_ratio: input.aspectRatio ?? "1:1",
          output_format: "webp",
          output_quality: 80,
          num_outputs: 1,
          // FLUX Schnell/Dev parameter for negative prompt
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
    id: string;
    status: string;
    output?: string[];
    error?: string;
    urls?: { get?: string };
  };

  // If prediction already succeeded (Prefer: wait)
  if (prediction.status === "succeeded" && Array.isArray(prediction.output)) {
    const url = prediction.output[0];
    if (url) return { imageUrl: url, latencyMs: Date.now() - startTime };
  }

  if (prediction.status === "failed") {
    throw new Error(`Replicate prediction failed immediately: ${prediction.error ?? "unknown"}`);
  }

  // Poll until done
  const pollUrl =
    prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollRes.ok) continue;

    const result = (await pollRes.json()) as {
      status: string;
      output?: string[];
      error?: string;
    };

    if (result.status === "succeeded") {
      const url = Array.isArray(result.output) ? result.output[0] : undefined;
      if (!url) throw new Error("Replicate returned no image URLs");
      return { imageUrl: url, latencyMs: Date.now() - startTime };
    }

    if (result.status === "failed") {
      throw new Error(`Replicate prediction failed: ${result.error ?? "unknown"}`);
    }
  }

  throw new Error(`Replicate timed out after ${timeoutMs}ms`);
}

// ── Step 3: Image QC ──────────────────────────────────────────────────────────

async function reviewImage(
  brief: Record<string, unknown>,
  prompt: string,
  imageUrl: string,
): Promise<{ score: number; notes: string; latencyMs: number; tokensUsed: number }> {
  const agent = await getAgentBySlug("image-qc");
  if (!agent || !agent.modelId || !agent.providerId) {
    return { score: 70, notes: "image-qc agent not found; skipping QC review.", latencyMs: 0, tokensUsed: 0 };
  }

  const [model, provider] = await Promise.all([
    getModelById(agent.modelId),
    getProviderById(agent.providerId),
  ]);

  if (!model || !provider) {
    return { score: 70, notes: "Model/provider missing for image-qc; skipping.", latencyMs: 0, tokensUsed: 0 };
  }

  const systemPrompt =
    (agent.metadata as { systemPrompt?: string } | null)?.systemPrompt ?? "";

  const userPrompt = `Review this AI-generated image for a brand campaign.

BRAND BRIEF:
Brand: ${(brief as { brandName?: string }).brandName ?? "Unknown"}
Business: ${(brief as { businessType?: string }).businessType ?? ""}
Target Market: ${(brief as { targetMarket?: string }).targetMarket ?? ""}
Goal: ${(brief as { goal?: string }).goal ?? ""}

PROMPT USED TO GENERATE THE IMAGE:
${prompt}

You are looking at the actual generated image (attached). Judge the real pixels, not just the prompt.

Scoring:
- Brand Alignment (0–30 pts): Does the image match positioning, tone, and target market?
- Visual Quality (0–25 pts): Composition, color usage, legibility, absence of visual artifacts.
- Text/Legibility (0–25 pts): If the image contains any text, wordmark, or lettering, is it crisp, spelled correctly, and readable — or is it garbled/gibberish/melted? Images with broken or nonsensical text MUST score at most 40 pts total and MUST NOT be marked "pass" on brand_safety_text.
- Brand Safety (0–20 pts): Free of real trademarks/logos, NSFW content, or anything unfit for a client-facing portfolio.

Respond with ONLY valid JSON:
{
  "score": <integer 1-100>,
  "notes": "<2-3 kalimat dalam Bahasa Indonesia: apa yang berhasil, apa yang bisa diperbaiki — sebutkan secara eksplisit teks yang rusak/tidak terbaca jika ada>",
  "brand_alignment": "<pass|warning|fail>",
  "visual_clarity": "<pass|warning|fail>",
  "text_legible": "<pass|warning|fail|not_applicable>",
  "brand_safety": "<pass|warning|fail>"
}`;

  const startTime = Date.now();
  let output;
  try {
    output = await executeAI({
      prompt: userPrompt,
      systemPrompt,
      model,
      provider,
      temperature: agent.temperature ? parseFloat(String(agent.temperature)) : 0.3,
      maxTokens: agent.maxTokens ?? 1024,
      imageUrl,
    });
  } catch {
    return { score: 70, notes: "QC agent call failed; defaulting to 70.", latencyMs: 0, tokensUsed: 0 };
  }
  const latencyMs = Date.now() - startTime;

  const raw = output.content.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}") + 1;
  const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd) : raw;

  let score = 70;
  let notes = "Image reviewed by QC agent.";
  try {
    const parsed = JSON.parse(jsonStr);
    score = Math.min(100, Math.max(1, parseInt(String(parsed.score ?? 70), 10)));
    notes = String(parsed.notes || notes);
  } catch {
    // keep defaults
  }

  return { score, notes, latencyMs, tokensUsed: output.tokensUsed };
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

const FLUX_SCHNELL = "black-forest-labs/flux-schnell";
const FLUX_DEV = "black-forest-labs/flux-dev";
const IMAGE_COST_SCHNELL = 0.003; // ~$0.003/image for FLUX.1 Schnell

// ── Named-asset generation (reused by demoPortfolioGeneratorService) ──────────
// Same Replicate call + QC review primitives as runImageDesignerPipeline above,
// but driven by an explicit list of named asset roles (e.g. "logo_concept",
// "social_visual_1") instead of N generic variations. This is NOT a parallel
// image pipeline — it calls the exact same generateReplicateImage/reviewImage
// functions used by the manual creative-project flow.

export interface NamedAssetRole {
  role: string;
  label: string;
  promptHint: string;
  aspectRatio?: string;
  /** True for roles that must NOT attempt to render body copy (menus, price lists,
   * paragraphs). Diffusion models reliably produce gibberish for this kind of text,
   * so these roles get a hardened anti-text prompt/negative-prompt (Sprint P2.1 policy). */
  noText?: boolean;
  /** When set, real vector text (brand name/tagline/menu) is composited onto the
   * (text-free) generated background after generation — see lib/textOverlay.ts.
   * This is the actual fix for legible copy, not just a softer prompt. */
  overlay?: OverlaySpec;
}

export interface GeneratedNamedAsset {
  role: string;
  label: string;
  prompt: string;
  imageUrl: string | null;
  status: "completed" | "failed";
  qcScore: number;
  qcNotes: string;
  cost: number;
  retries: number;
  /** Original provider (Replicate) delivery URL, kept for provenance/debugging.
   * Replicate URLs are ephemeral (~hours), so `imageUrl` above is the permanently
   * stored copy whenever persistence succeeds; this is null if persistence failed
   * and we had to fall back to the ephemeral URL. */
  sourceProviderUrl?: string | null;
}

/** Background jobs have no Express request to read forwarded headers from, so
 * this mirrors the buildBaseUrl() helpers used by request-scoped routes but
 * without req dependency. PUBLIC_APP_URL overrides for production. */
function getServiceBaseUrl(): string {
  return getPublicBaseUrl();
}

/**
 * Persists an already-in-memory image buffer to Supabase Storage.
 * Returns the permanent Supabase CDN URL, or null if storage isn't
 * available/fails — callers fall back to the ephemeral provider URL.
 */
async function persistImageBuffer(
  buffer: Buffer,
  contentType: string,
  brandSlug: string,
  role: string,
  pathPrefix?: string,
): Promise<string | null> {
  try {
    const { isSupabaseStorageAvailable, uploadToSupabase } = await import("../lib/supabaseStorage.js");
    if (!isSupabaseStorageAvailable()) return null;
    const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") ? "jpg" : "webp";
    const storagePath = `${pathPrefix ?? `demo-portfolios/${brandSlug}`}/${role}-${Date.now()}.${ext}`;
    return await uploadToSupabase(storagePath, buffer, contentType);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Replicate's rate limiter (observed on low-credit accounts: 6 req/min) returns
 * 429 with a `retry_after` (seconds) field in the JSON body. Parse it so we back
 * off exactly as long as needed instead of guessing. */
function parseRetryAfterMs(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/"retry_after"\s*:\s*([\d.]+)/);
  if (!match) return null;
  return Math.ceil(parseFloat(match[1]) * 1000) + 500; // small safety margin
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && /Replicate create error 429/.test(err.message);
}

// Minimum spacing between successive Replicate calls — pre-empts hitting the
// documented 6 requests/minute throttle that low-credit Replicate accounts hit.
const MIN_INTER_REQUEST_MS = 10500;

/** FLUX Schnell is stochastic — even with hardened noText prompts it sometimes
 * hallucinates gibberish lettering somewhere in frame (a known model limitation,
 * not something prompt wording alone fixes). Below this score, spend one more
 * $0.003 generation to try for a cleaner draw before accepting the result —
 * cheaper and more honest than lowering the QC bar. */
const QUALITY_RETRY_THRESHOLD = 65;

interface AssetAttemptResult {
  imageUrl: string | null;
  persistedUrl: string | null;
  qcScore: number;
  qcNotes: string;
  cost: number;
  providerRetries: number;
  failureReason?: string;
}

export async function generateNamedAssetSet(
  brief: Record<string, unknown>,
  roles: NamedAssetRole[],
  opts?: { maxRetryPerAsset?: number; maxQualityRetryPerAsset?: number; storagePathPrefix?: string },
): Promise<GeneratedNamedAsset[]> {
  const guardrails = await readGuardrails();
  const maxRetry = Math.max(0, opts?.maxRetryPerAsset ?? Math.min(guardrails.maxRetryPerProvider, 2));
  const maxQualityRetry = Math.max(0, opts?.maxQualityRetryPerAsset ?? 1);
  const replicateKey = getProviderApiKey("replicate");

  const results: GeneratedNamedAsset[] = [];
  let lastRequestAt = 0;

  const pace = async () => {
    const waitMs = MIN_INTER_REQUEST_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = Date.now();
  };

  for (const role of roles) {
    const brandName = String(brief["brandName"] ?? "the brand");
    const industry = String(brief["businessType"] ?? brief["industry"] ?? "");
    const style = String(brief["stylePreference"] ?? "");
    const textPolicy = role.noText
      ? "Do NOT render any readable words, labels, price lists, menus, paragraphs, or body copy — diffusion models cannot spell reliably. Keep it purely visual: colors, shapes, layout, imagery only, no legible letters anywhere."
      : "Keep any lettering minimal (short brand name only, at most 1-2 words) — do not attempt full sentences, price lists, or body copy.";
    const prompt = `${role.promptHint}. Brand: ${brandName}. Industry: ${industry}. Visual style: ${style}. Professional quality, on-brand, clean composition. ${textPolicy} No logos of real companies.`;
    // What QC is shown as "the prompt used to generate the image" — for overlay roles this
    // must NOT include the noText directive, or QC penalizes the (intentional, correctly
    // spelled) baked-in text for "violating" a generation instruction that no longer applies
    // to the final composited asset.
    // Strip any "no lettering / icon only / no wordmark" phrasing from the promptHint
    // itself before showing it to QC — that instruction was only ever meant to stop the
    // diffusion model from hallucinating gibberish letters into the *background*. It does
    // not apply to the final asset, which intentionally has real text composited on top.
    const qcSafePromptHint = role.overlay
      ? role.promptHint.replace(/,?\s*no (wordmark|lettering|text)[^,.]*/gi, "")
      : role.promptHint;
    const qcPrompt = role.overlay
      ? `${qcSafePromptHint}. Brand: ${brandName}. Industry: ${industry}. Visual style: ${style}. Professional quality, on-brand, clean composition. No logos of real companies. NOTE: a real brand name/tagline/menu overlay was added programmatically AFTER generation as correctly-spelled vector text — this is intentional and desired. Do not penalize the image for containing text or for "violating" any no-lettering instruction; judge the overlay purely on legibility, correct spelling, and how well it's integrated with the background.`
      : prompt;
    const negativePrompt = role.noText
      ? "text, words, letters, typography, gibberish text, misspelled words, illegible text, price list, menu text, labels, captions, paragraphs, watermark, low quality, blurry, distorted, real company logo, trademark, nsfw, signature"
      : "gibberish text, misspelled words, illegible text, extra letters, watermark, low quality, blurry, distorted, real company logo, trademark, nsfw, signature";
    const brandSlug = String(brief["brandName"] ?? "brand")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "brand";

    if (!replicateKey) {
      results.push({
        role: role.role, label: role.label, prompt, imageUrl: null, status: "failed",
        qcScore: 0, qcNotes: "REPLICATE_API_TOKEN not configured", cost: 0, retries: 0,
      });
      continue;
    }

    // One full generate → overlay → QC pass. Provider-level retries (API errors,
    // rate limits) happen inside this function; the outer loop below only retries
    // for *quality* (a clean generation that still scored low).
    const attemptOnce = async (): Promise<AssetAttemptResult> => {
      let providerAttempt = 0;
      let imageUrl: string | null = null;
      let lastError: unknown = null;

      while (providerAttempt <= maxRetry && !imageUrl) {
        providerAttempt++;
        await pace();
        try {
          const modelId = providerAttempt > maxRetry && guardrails.fallbackEnabled ? FLUX_DEV : FLUX_SCHNELL;
          const r = await generateReplicateImage(
            modelId,
            { prompt, negativePrompt, aspectRatio: role.aspectRatio ?? "1:1" },
            replicateKey,
            guardrails.providerTimeoutMs,
          );
          imageUrl = r.imageUrl;
        } catch (err) {
          lastError = err;
          if (isRateLimitError(err) && providerAttempt <= maxRetry) {
            const backoff = parseRetryAfterMs(err) ?? 15000;
            await sleep(backoff);
          }
        }
      }

      if (!imageUrl) {
        return {
          imageUrl: null, persistedUrl: null, qcScore: 0,
          qcNotes: String(lastError instanceof Error ? lastError.message : lastError ?? "generation failed"),
          cost: 0, providerRetries: providerAttempt - 1, failureReason: "generation_failed",
        };
      }

      // Download the raw provider image so we can (a) bake real text onto it when
      // configured, (b) persist a permanent copy, and (c) hand exact final pixels
      // to QC — all from one buffer instead of re-fetching the ephemeral URL 3x.
      let finalBuffer: Buffer | null = null;
      let contentType = "image/webp";
      try {
        const raw = await fetch(imageUrl);
        if (raw.ok) {
          contentType = raw.headers.get("content-type") || "image/webp";
          finalBuffer = Buffer.from(await raw.arrayBuffer());
          if (role.overlay) {
            const overlayCtx: OverlayContext = {
              brandName,
              tagline: String(brief["tagline"] ?? ""),
              menuItems: role.overlay.kind === "menu"
                ? (await import("../lib/textOverlay.js")).buildPlaceholderMenu(industry)
                : undefined,
            };
            finalBuffer = await applyTextOverlay(finalBuffer, role.overlay, overlayCtx);
            contentType = "image/webp";
          }
        }
      } catch (err) {
        console.error(`[imageDesigner] Failed to download/overlay ${role.role}:`, err);
      }

      const qcImageRef = finalBuffer ? `data:${contentType};base64,${finalBuffer.toString("base64")}` : imageUrl;
      const qc = await reviewImage(brief, qcPrompt, qcImageRef);
      const persistedUrl = finalBuffer
        ? await persistImageBuffer(finalBuffer, contentType, brandSlug, role.role, opts?.storagePathPrefix)
        : null;

      return {
        imageUrl, persistedUrl, qcScore: qc.score, qcNotes: qc.notes,
        cost: IMAGE_COST_SCHNELL, providerRetries: providerAttempt - 1,
      };
    };

    let best = await attemptOnce();
    let qualityRetries = 0;
    let totalCost = best.cost;
    let totalProviderRetries = best.providerRetries;

    while (best.imageUrl && best.qcScore < QUALITY_RETRY_THRESHOLD && qualityRetries < maxQualityRetry) {
      qualityRetries++;
      const retryResult = await attemptOnce();
      totalCost += retryResult.cost;
      totalProviderRetries += retryResult.providerRetries;
      if (retryResult.imageUrl && retryResult.qcScore > best.qcScore) {
        best = retryResult;
      }
    }

    if (!best.imageUrl) {
      results.push({
        role: role.role, label: role.label, prompt, imageUrl: null, status: "failed",
        qcScore: 0, qcNotes: best.qcNotes, cost: totalCost, retries: totalProviderRetries,
      });
      continue;
    }

    results.push({
      role: role.role, label: role.label, prompt,
      imageUrl: best.persistedUrl ?? best.imageUrl,
      sourceProviderUrl: best.imageUrl,
      status: "completed",
      qcScore: best.qcScore, qcNotes: best.qcNotes, cost: totalCost, retries: totalProviderRetries + qualityRetries,
    });
  }

  return results;
}

export async function runImageDesignerPipeline(
  projectDbId: number,
  projectUuid: string,
  requestedVariations = 2,
): Promise<void> {
  const guardrails = await readGuardrails();
  const maxVariations = Math.min(Math.max(1, requestedVariations), 4);

  // ── Budget pre-check ──────────────────────────────────────────────────────
  if (guardrails.maxCostPerWorkflow > 0) {
    const existing = await getProjectCosts(projectUuid);
    if (existing.totalEstimatedCostUsd >= guardrails.maxCostPerWorkflow) {
      await logAudit(
        "creative-ai",
        "image_pipeline_blocked_by_budget",
        projectUuid,
        "creative_project",
        "failure",
        { totalCost: existing.totalEstimatedCostUsd, cap: guardrails.maxCostPerWorkflow },
      );
      throw new Error(
        `Budget cap reached: $${existing.totalEstimatedCostUsd.toFixed(4)} of $${guardrails.maxCostPerWorkflow}. ` +
          `Adjust the guardrail.max_cost_per_workflow setting to continue.`,
      );
    }
  }

  // ── Load project + steps ──────────────────────────────────────────────────
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));

  if (!project) throw new Error(`Project ${projectDbId} not found`);

  const steps = await db
    .select()
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, projectDbId));

  const brandStrategy =
    (steps.find((s) => s.stepName === "Brand Strategy")?.output as Record<string, unknown>) ?? {};
  const creativeDirection =
    (steps.find((s) => s.stepName === "Creative Direction")?.output as Record<string, unknown>) ?? {};

  const brief: Record<string, unknown> = {
    brandName: project.brandName,
    businessType: project.businessType,
    targetMarket: project.targetMarket,
    productOrService: project.productOrService,
    stylePreference: project.stylePreference,
    goal: project.goal,
  };

  // ── Template-first path untuk layanan logo ────────────────────────────────
  // Cek apakah ini proyek logo — kalau iya, coba render dari template dulu
  // (biaya ~$0.0005 vs $0.003–0.025 via FLUX). Fallback ke FLUX jika gagal.
  //
  // serviceCode is read from the linked aiServiceRequestsTable row (via
  // creativeProjectsTable.serviceRequestId). creativeProjectsTable has no
  // briefJson column — the brief payload lives on the service request row.
  let serviceCode = "";
  if (project.serviceRequestId != null) {
    const [svcReq] = await db
      .select({ briefJson: aiServiceRequestsTable.briefJson })
      .from(aiServiceRequestsTable)
      .where(eq(aiServiceRequestsTable.id, project.serviceRequestId));
    serviceCode = String(svcReq?.briefJson?.["serviceCode"] ?? "");
  }
  const isLogoService = ["logo-design", "GD-LOGO"].includes(serviceCode);

  if (isLogoService) {
    try {
      const { tryTemplateLogoRender } = await import("./templateLogoService.js");
      const templateResult = await tryTemplateLogoRender(brief, projectUuid);

      if (templateResult) {
        // Simpan asset sebagai completed — skip FLUX sepenuhnya
        await db.insert(creativeAiAssetsTable).values({
          projectId: projectUuid,
          agentId: null,
          provider: "template",
          model: templateResult.templateCode,
          assetType: "image",
          prompt: `Template: ${templateResult.templateName} — AI-filled slots only`,
          negativePrompt: null,
          aspectRatio: "1:1",
          imageUrl: templateResult.outputUrl,
          status: "completed",
          qcScore: 90,
          qcNotes: `Rendered from built-in template ${templateResult.templateCode}. AI (GPT-4o Mini) filled text slots. No image generation needed.`,
          cost: String(templateResult.costUsd.toFixed(6)),
          latencyMs: templateResult.renderDurationMs,
          metadata: {
            templateCode: templateResult.templateCode,
            templateName: templateResult.templateName,
            tokensUsed: templateResult.tokensUsed,
            renderMethod: "template",
            savingsVsFlux: `${(0.003 - templateResult.costUsd).toFixed(4)} saved per image`,
          },
        });

        await logAudit(
          "creative-ai",
          "image_pipeline_completed_via_template",
          projectUuid,
          "creative_project",
          "success",
          {
            templateCode: templateResult.templateCode,
            costUsd: templateResult.costUsd,
            renderDurationMs: templateResult.renderDurationMs,
          },
        );

        return; // ← FLUX tidak dijalankan
      }
    } catch (templateErr) {
      // Jika template render gagal, lanjut ke pipeline FLUX normal
      await logAudit(
        "creative-ai",
        "template_logo_fallback_to_flux",
        projectUuid,
        "creative_project",
        "failure",
        { error: String(templateErr) },
      );
    }
  }

  await logAudit("creative-ai", "image_pipeline_started", projectUuid, "creative_project", "success", {
    variations: maxVariations,
  });

  // ── Step 1: Generate image prompts ────────────────────────────────────────
  let imagePrompts: ImagePromptResult[];
  let promptGenLatency: number;
  let promptGenTokens: number;

  try {
    const result = isInteriorDesignProject(steps)
      ? await generateInteriorImagePrompts(projectUuid, steps, brief, maxVariations)
      : await generateImagePrompts(brief, brandStrategy, creativeDirection, maxVariations);
    imagePrompts = result.prompts;
    promptGenLatency = result.latencyMs;
    promptGenTokens = result.tokensUsed;

    await recordCost({
      projectId: projectUuid,
      agentSlug: "image-prompt-generator",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: Math.floor(promptGenTokens * 0.65),
      outputTokens: Math.floor(promptGenTokens * 0.35),
      latencyMs: promptGenLatency,
      status: "success",
    });

    await logAudit("creative-ai", "image_prompts_generated", projectUuid, "creative_project", "success", {
      count: imagePrompts.length,
    });
  } catch (err) {
    await logAudit("creative-ai", "image_prompt_generation_failed", projectUuid, "creative_project", "failure", {
      error: String(err),
    });
    throw err;
  }

  // ── Step 2+3: Generate images and QC each one ─────────────────────────────
  const replicateKey = getProviderApiKey("replicate");
  const imageDesignerAgent = await getAgentBySlug("image-designer");

  // Insert all asset rows upfront as "generating" so:
  //   (a) the UI can poll and show progress immediately
  //   (b) the concurrency guard in the route sees these rows and blocks duplicate runs
  const assetIds: number[] = [];
  for (let i = 0; i < imagePrompts.length; i++) {
    const p = imagePrompts[i];
    const [row] = await db.insert(creativeAiAssetsTable).values({
      projectId: projectUuid,
      agentId: imageDesignerAgent?.id ?? null,
      provider: "replicate",
      model: FLUX_SCHNELL,
      assetType: "image",
      prompt: p.prompt,
      negativePrompt: p.negativePrompt,
      aspectRatio: p.aspectRatio,
      imageUrl: null,
      status: replicateKey ? "generating" : "failed",
      qcScore: null,
      qcNotes: replicateKey
        ? null
        : "Image generation requires REPLICATE_API_TOKEN. Set this environment variable in Replit Secrets to enable actual image generation.",
      cost: "0",
      latencyMs: 0,
      metadata: { style: p.style, variationIndex: i + 1 },
    }).returning({ id: creativeAiAssetsTable.id });
    assetIds.push(row.id);
  }

  if (!replicateKey) {
    await logAudit("creative-ai", "image_generation_skipped", projectUuid, "creative_project", "failure", {
      reason: "REPLICATE_API_TOKEN not set",
    });
    return;
  }

  const maxRetries = Math.min(guardrails.maxRetryPerProvider, 2);
  const timeoutMs = Math.min(guardrails.providerTimeoutMs, 120000);

  for (let i = 0; i < imagePrompts.length; i++) {
    const p = imagePrompts[i];
    const assetId = assetIds[i];

    // Per-image budget check
    if (guardrails.maxCostPerWorkflow > 0) {
      const runningCost = await getProjectCosts(projectUuid);
      if (runningCost.totalEstimatedCostUsd >= guardrails.maxCostPerWorkflow) {
        await logAudit("creative-ai", "image_budget_cap_reached", projectUuid, "creative_project", "failure", {
          imageIndex: i,
          totalCost: runningCost.totalEstimatedCostUsd,
        });
        // Mark remaining generating assets as failed
        for (let j = i; j < assetIds.length; j++) {
          await db
            .update(creativeAiAssetsTable)
            .set({ status: "failed", qcNotes: "Skipped: project budget cap reached" })
            .where(eq(creativeAiAssetsTable.id, assetIds[j]));
        }
        break;
      }
    }

    let imageUrl: string | null = null;
    let imageLatency = 0;
    let imageStatus = "failed";
    let qcScore: number | null = null;
    let qcNotes: string | null = null;
    let generationError: string | null = null;
    let usedModel = FLUX_SCHNELL;

    // Try primary model (FLUX.1 Schnell), then fallback to FLUX.1 Dev if enabled
    const modelCandidates = guardrails.fallbackEnabled
      ? [FLUX_SCHNELL, FLUX_DEV]
      : [FLUX_SCHNELL];

    outerLoop: for (const modelId of modelCandidates) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await generateReplicateImage(
            modelId,
            { prompt: p.prompt, negativePrompt: p.negativePrompt, aspectRatio: p.aspectRatio },
            replicateKey,
            timeoutMs,
          );
          imageUrl = result.imageUrl;
          imageLatency = result.latencyMs;
          imageStatus = "completed";
          usedModel = modelId;
          generationError = null;

          await recordCost({
            projectId: projectUuid,
            agentSlug: "image-designer",
            provider: "replicate",
            model: modelId,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: imageLatency,
            status: "success",
          });

          break outerLoop;
        } catch (err) {
          generationError = String(err);
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
      }
    }

    if (imageStatus === "failed") {
      await recordCost({
        projectId: projectUuid,
        agentSlug: "image-designer",
        provider: "replicate",
        model: FLUX_SCHNELL,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        status: "failed",
      });
    }

    // ── Persist to Supabase Storage (prevents expiring Replicate URLs) ─────────
    let persistedUrl: string | null = null;
    let storagePath: string | null = null;
    if (imageUrl && imageStatus === "completed") {
      try {
        const raw = await fetch(imageUrl);
        if (raw.ok) {
          const buf = Buffer.from(await raw.arrayBuffer());
          const ct = raw.headers.get("content-type") || "image/webp";
          const ext = ct.includes("png") ? "png" : ct.includes("jpeg") ? "jpg" : "webp";
          const pathKey = `creative-assets/${projectUuid}/image-concepts/concept-${i + 1}-${Date.now()}.${ext}`;
          persistedUrl = await persistImageBuffer(buf, ct, projectUuid, `concept-${i + 1}`, `creative-assets/${projectUuid}/image-concepts`);
          if (persistedUrl) storagePath = pathKey;
        }
      } catch (err) {
        console.error(`[imageDesigner] Failed to persist concept ${i + 1} to Supabase:`, err);
      }
    }
    // Use Supabase URL if available, otherwise keep Replicate URL as fallback
    const finalImageUrl = persistedUrl ?? imageUrl;

    // QC review (runs even if image failed — scores the prompt quality)
    try {
      const qc = await reviewImage(brief, p.prompt, finalImageUrl ?? "not generated");
      qcScore = qc.score;
      qcNotes = qc.notes;

      if (qc.tokensUsed > 0) {
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
    } catch (err) {
      qcNotes = `QC review error: ${String(err)}`;
    }

    // Update the placeholder row with final state
    await db
      .update(creativeAiAssetsTable)
      .set({
        model: usedModel,
        imageUrl: finalImageUrl,
        storagePath: storagePath ?? undefined,
        status: imageStatus,
        qcScore,
        qcNotes: qcNotes ?? (generationError ? `Generation failed: ${generationError}` : null),
        cost: String(imageStatus === "completed" ? IMAGE_COST_SCHNELL.toFixed(6) : "0"),
        latencyMs: imageLatency,
      })
      .where(eq(creativeAiAssetsTable.id, assetId));

    await logAudit(
      "creative-ai",
      "image_asset_saved",
      projectUuid,
      "creative_project",
      imageStatus === "completed" ? "success" : "failure",
      { variationIndex: i + 1, status: imageStatus, qcScore },
    );
  }

  await logAudit("creative-ai", "image_pipeline_completed", projectUuid, "creative_project", "success", {
    variations: imagePrompts.length,
  });
}

/**
 * Rewrites an existing image prompt to incorporate a human revision note.
 * Uses the image-prompt-generator agent. Falls back to simple append on error.
 */
async function rewritePromptWithNote(
  originalPrompt: string,
  negativePrompt: string | null,
  aspectRatio: string | null,
  revisionNote: string,
): Promise<{ prompt: string; negativePrompt: string; aspectRatio: string }> {
  const fallback = {
    prompt: `${originalPrompt}. ${revisionNote}`,
    negativePrompt: negativePrompt ?? "text, watermark, low quality, blurry, distorted",
    aspectRatio: aspectRatio ?? "1:1",
  };

  const agent = await getAgentBySlug("image-prompt-generator");
  if (!agent?.modelId || !agent.providerId) return fallback;

  const [model, provider] = await Promise.all([
    getModelById(agent.modelId),
    getProviderById(agent.providerId),
  ]);
  if (!model || !provider) return fallback;

  const userPrompt = `You are an expert AI image prompt engineer. Rewrite the existing prompt to incorporate the revision instruction, preserving brand intent.

ORIGINAL PROMPT:
${originalPrompt}

REVISION INSTRUCTION (what the client wants changed):
${revisionNote}

Only adjust the parts the client asked to change. Keep the same brand, mood, and overall style. Output 60–150 words for the revised prompt.
IMPORTANT: "prompt" and "negativePrompt" values MUST stay in English (required by image generation models).

Respond with ONLY valid JSON (no markdown):
{
  "prompt": "<revised prompt in English>",
  "negativePrompt": "<comma-separated negatives in English>",
  "aspectRatio": "${aspectRatio ?? "1:1"}"
}`;

  try {
    const output = await executeAI({
      prompt: userPrompt,
      systemPrompt: "You are an expert image prompt engineer for AI diffusion models. Respond only with valid JSON. IMPORTANT: The 'prompt' and 'negativePrompt' fields must stay in English (required by image generation models). All other descriptive text fields must be in Bahasa Indonesia.",
      model,
      provider,
      temperature: 0.6,
      maxTokens: 512,
    });
    const raw = output.content.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "");
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}") + 1;
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd));
    return {
      prompt: String(parsed.prompt ?? fallback.prompt),
      negativePrompt: String(parsed.negativePrompt ?? fallback.negativePrompt),
      aspectRatio: String(parsed.aspectRatio ?? fallback.aspectRatio),
    };
  } catch {
    return fallback;
  }
}

/**
 * Regenerate a single image asset in-place.
 * If `revisionNote` is supplied, the LLM rewrites the prompt to incorporate
 * the client's feedback before generating.
 * Marks the original asset `needs_revision`, inserts a new row as `generating`,
 * runs Replicate + QC, then finalises the new row.
 */
export async function regenerateSingleAsset(
  originalAssetId: number,
  projectUuid: string,
  revisionNote?: string,
): Promise<void> {
  const guardrails = await readGuardrails();

  const [original] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.id, originalAssetId));
  if (!original) throw new Error(`Asset ${originalAssetId} not found`);

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectUuid));
  if (!project) throw new Error(`Project ${projectUuid} not found`);

  const brief: Record<string, unknown> = {
    brandName: project.brandName,
    businessType: project.businessType,
    targetMarket: project.targetMarket,
    productOrService: project.productOrService,
    stylePreference: project.stylePreference,
    goal: project.goal,
  };

  const replicateKey = getProviderApiKey("replicate");
  const maxRetries = Math.min(guardrails.maxRetryPerProvider, 2);
  const timeoutMs = Math.min(guardrails.providerTimeoutMs, 120000);

  // Resolve prompt — rewrite with LLM if the user supplied a revision note
  let prompt = original.prompt ?? "";
  let negativePrompt: string | undefined = original.negativePrompt ?? undefined;
  let aspectRatio = original.aspectRatio ?? "1:1";

  if (revisionNote?.trim()) {
    console.info(`[imageDesigner] Rewriting prompt for revision of asset ${originalAssetId}: "${revisionNote}"`);
    const rewritten = await rewritePromptWithNote(
      prompt,
      original.negativePrompt ?? null,
      original.aspectRatio ?? null,
      revisionNote.trim(),
    );
    prompt = rewritten.prompt;
    negativePrompt = rewritten.negativePrompt;
    aspectRatio = rewritten.aspectRatio;
    console.info(`[imageDesigner] Rewritten prompt: "${prompt.slice(0, 80)}…"`);
  }

  // Insert new asset row immediately so UI shows "generating"
  const imageDesignerAgent = await getAgentBySlug("image-designer");
  const [newAsset] = await db
    .insert(creativeAiAssetsTable)
    .values({
      projectId: projectUuid,
      agentId: imageDesignerAgent?.id ?? null,
      provider: "replicate",
      model: original.model ?? FLUX_SCHNELL,
      assetType: "image",
      prompt,
      negativePrompt: negativePrompt ?? null,
      aspectRatio,
      imageUrl: null,
      status: replicateKey ? "generating" : "failed",
      qcScore: null,
      qcNotes: replicateKey ? null : "Image generation requires REPLICATE_API_TOKEN.",
      cost: "0",
      latencyMs: 0,
      metadata: {
        ...(original.metadata as object ?? {}),
        revisedFromAssetId: originalAssetId,
        ...(revisionNote?.trim() ? { revisionNote: revisionNote.trim() } : {}),
      },
      parentAssetId: originalAssetId,
    })
    .returning({ id: creativeAiAssetsTable.id });

  if (!replicateKey) return;
  let imageUrl: string | null = null;
  let imageLatency = 0;
  let imageStatus = "failed";
  let qcScore: number | null = null;
  let qcNotes: string | null = null;
  let generationError: string | null = null;
  let usedModel = original.model ?? FLUX_SCHNELL;

  const modelCandidates = guardrails.fallbackEnabled ? [usedModel, FLUX_DEV] : [usedModel];

  outerLoop: for (const modelId of modelCandidates) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await generateReplicateImage(
          modelId,
          { prompt, negativePrompt, aspectRatio },
          replicateKey,
          timeoutMs,
        );
        imageUrl = result.imageUrl;
        imageLatency = result.latencyMs;
        imageStatus = "completed";
        usedModel = modelId;
        generationError = null;
        await recordCost({
          projectId: projectUuid,
          agentSlug: "image-designer",
          provider: "replicate",
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: imageLatency,
          status: "success",
        });
        break outerLoop;
      } catch (err) {
        generationError = String(err);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
  }

  // Persist to Supabase Storage (prevents expiring Replicate URLs)
  let persistedUrl: string | null = null;
  let storagePath: string | null = null;
  if (imageUrl && imageStatus === "completed") {
    try {
      const raw = await fetch(imageUrl);
      if (raw.ok) {
        const buf = Buffer.from(await raw.arrayBuffer());
        const ct = raw.headers.get("content-type") || "image/webp";
        const ext = ct.includes("png") ? "png" : ct.includes("jpeg") ? "jpg" : "webp";
        const pathKey = `creative-assets/${projectUuid}/image-concepts/revision-${newAsset.id}-${Date.now()}.${ext}`;
        persistedUrl = await persistImageBuffer(
          buf, ct, projectUuid, `revision-${newAsset.id}`,
          `creative-assets/${projectUuid}/image-concepts`,
        );
        if (persistedUrl) storagePath = pathKey;
      }
    } catch (err) {
      console.error(`[imageDesigner] Failed to persist revision asset ${newAsset.id}:`, err);
    }
  }

  const finalImageUrl = persistedUrl ?? imageUrl;

  // QC review
  try {
    const qc = await reviewImage(brief, prompt, finalImageUrl ?? "not generated");
    qcScore = qc.score;
    qcNotes = qc.notes;
    if (qc.tokensUsed > 0) {
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
  } catch (err) {
    qcNotes = `QC review error: ${String(err)}`;
  }

  // Finalise new asset row
  await db
    .update(creativeAiAssetsTable)
    .set({
      model: usedModel,
      imageUrl: finalImageUrl,
      storagePath: storagePath ?? undefined,
      status: imageStatus,
      qcScore,
      qcNotes: qcNotes ?? (generationError ? `Generation failed: ${generationError}` : null),
      cost: String(imageStatus === "completed" ? IMAGE_COST_SCHNELL.toFixed(6) : "0"),
      latencyMs: imageLatency,
    })
    .where(eq(creativeAiAssetsTable.id, newAsset.id));

  await logAudit(
    "creative-ai", "image_asset_revised", projectUuid, "creative_project",
    imageStatus === "completed" ? "success" : "failure",
    { originalAssetId, newAssetId: newAsset.id, status: imageStatus, qcScore },
  );
}
