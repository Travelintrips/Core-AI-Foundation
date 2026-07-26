/**
 * livePreviewService — "Try the AI before you buy" (Live AI Preview).
 *
 * Flow: AI Brand Strategist -> Creative Director -> Image Designer ->
 * generate 2 concepts -> show a watermarked, low-res, non-downloadable
 * preview. Free, but capped at MAX_PREVIEWS_PER_SESSION per browser
 * session so it can never be used as a free production tool.
 *
 * "Continue With This Concept" hands the *exact* persisted concept into
 * the existing Brief -> Checkout -> Payment -> Project pipeline — this
 * service never regenerates on continue.
 */
import { eq, and, count } from "drizzle-orm";
import { db, aiLivePreviewsTable, aiServicesTable } from "@workspace/db";
import { getProviderApiKey } from "./aiSecretService.js";
import { getAllActiveModels } from "./aiModelService.js";
import { routeForAgent } from "./intelligentRouter.js";
import { executeAI, type ExecutionInput } from "./aiExecutionService.js";
import { parseJsonResponse } from "./creativeAiService.js";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

export const MAX_PREVIEWS_PER_SESSION = 2;

const FLUX_SCHNELL = "black-forest-labs/flux-schnell";

export interface LivePreviewInput {
  sessionId: string;
  serviceId: number;
  companyName: string;
  industry: string;
  style: string;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  shortDescription?: string | null;
  referenceImageUrl?: string | null;
}

export interface ConceptResult {
  name: string;
  style_explanation: string;
  reasoning: string;
  color_recommendation: { primary: string; secondary: string; accent?: string };
  typography_recommendation: { heading: string; body: string };
  rating: number; // 1-5, AI self-assessed confidence
  imageDataUrl: string | null; // base64 data URI — never the raw Replicate URL, so it can't be re-hosted/downloaded from outside our app
}

export async function countPreviewsForSession(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(aiLivePreviewsTable)
    .where(eq(aiLivePreviewsTable.sessionId, sessionId));
  return Number(row?.n ?? 0);
}

function buildConceptPrompt(input: LivePreviewInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a senior Brand Strategist and Creative Director working together to pitch a brand identity concept in seconds. You always answer with strict, valid JSON — no markdown, no commentary. Write all descriptive text values (name, style_explanation, reasoning) in Bahasa Indonesia yang profesional.`;
  const userPrompt = `Create TWO distinct brand identity concepts (Concept A and Concept B) for:

COMPANY: ${input.companyName}
INDUSTRY: ${input.industry}
STYLE PREFERENCE: ${input.style}
PRIMARY COLOR: ${input.primaryColor ?? "AI's choice"}
SECONDARY COLOR: ${input.secondaryColor ?? "AI's choice"}
DESCRIPTION: ${input.shortDescription ?? "n/a"}

The two concepts must feel meaningfully different from each other (e.g. one bolder/one more restrained) while both fitting the brief. Return JSON exactly in this shape:
{
  "concept_a": {
    "name": "short concept name",
    "style_explanation": "1-2 sentences describing the visual direction",
    "reasoning": "1-2 sentences on why this fits the brand/industry",
    "color_recommendation": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
    "typography_recommendation": { "heading": "font family name", "body": "font family name" },
    "rating": 4.5,
    "image_prompt": "a single, vivid, production-ready text-to-image prompt (no text/words in the image) depicting a logo/brand mark mockup for this concept"
  },
  "concept_b": { ...same shape, a distinctly different direction... }
}`;
  return { systemPrompt, userPrompt };
}

async function generatePreviewImage(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const createRes = await fetch(`https://api.replicate.com/v1/models/${FLUX_SCHNELL}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Prefer: "wait" },
      body: JSON.stringify({
        input: { prompt, aspect_ratio: "1:1", output_format: "webp", output_quality: 60, num_outputs: 1 },
      }),
    });
    if (!createRes.ok) return null;
    const prediction = (await createRes.json()) as { status: string; output?: string[]; urls?: { get?: string } };
    let imageUrl: string | undefined = Array.isArray(prediction.output) ? prediction.output[0] : undefined;

    if (!imageUrl && prediction.urls?.get) {
      const startTime = Date.now();
      while (Date.now() - startTime < 45_000) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(prediction.urls.get, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!pollRes.ok) continue;
        const result = (await pollRes.json()) as { status: string; output?: string[] };
        if (result.status === "succeeded") {
          imageUrl = Array.isArray(result.output) ? result.output[0] : undefined;
          break;
        }
        if (result.status === "failed") break;
      }
    }
    if (!imageUrl) return null;

    // Fetch the image ourselves and return as a data URL — the raw
    // Replicate URL is never exposed to the client (spec: "Disable
    // Original URL" / "Tidak dapat di-download").
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/webp";
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function generateLivePreview(previewId: number, input: LivePreviewInput): Promise<void> {
  try {
    const [service] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, input.serviceId)).limit(1);
    if (!service) throw new Error("Service not found");

    const routing = await routeForAgent("creative-director", { prompt: "live-preview", requiredContextTokens: 1200 });
    let selectedModel = routing?.selected ?? null;
    if (!selectedModel) {
      const active = await getAllActiveModels();
      selectedModel = active.find((m) => !!getProviderApiKey(m.provider.slug)) ?? null;
    }
    if (!selectedModel) throw new Error("No active AI model configured — set at least one provider API key.");

    const { systemPrompt, userPrompt } = buildConceptPrompt(input);
    const execInput: ExecutionInput = {
      prompt: userPrompt,
      systemPrompt,
      model: selectedModel.model,
      provider: selectedModel.provider,
      temperature: 0.85,
      maxTokens: 1400,
    };
    const result = await executeAI(execInput);
    const parsed = parseJsonResponse(result.content) as { concept_a?: Record<string, unknown>; concept_b?: Record<string, unknown> };
    if (!parsed.concept_a || !parsed.concept_b) throw new Error("AI response did not include both concepts");

    const replicateKey = getProviderApiKey("replicate");
    const [imageA, imageB] = replicateKey
      ? await Promise.all([
          generatePreviewImage(String(parsed.concept_a["image_prompt"] ?? ""), replicateKey),
          generatePreviewImage(String(parsed.concept_b["image_prompt"] ?? ""), replicateKey),
        ])
      : [null, null];

    await db
      .update(aiLivePreviewsTable)
      .set({
        conceptA: { ...parsed.concept_a, imageDataUrl: imageA },
        conceptB: { ...parsed.concept_b, imageDataUrl: imageB },
        status: "ready",
        updatedAt: new Date(),
      })
      .where(eq(aiLivePreviewsTable.id, previewId));

    await logAudit("live-preview", "preview_generated", String(previewId), "ai_live_preview", "success", {
      serviceId: input.serviceId,
      industry: input.industry,
      style: input.style,
      hasImages: !!(imageA || imageB),
    });
    await publishSafe({
      eventType: "preview_generated",
      sourceModule: "live-preview",
      payload: { previewId, serviceId: input.serviceId, industry: input.industry, style: input.style },
    });
  } catch (err) {
    await db
      .update(aiLivePreviewsTable)
      .set({ status: "failed", errorMessage: String(err), updatedAt: new Date() })
      .where(eq(aiLivePreviewsTable.id, previewId));
    await logAudit("live-preview", "preview_failed", String(previewId), "ai_live_preview", "failure", { error: String(err) });
  }
}
