/**
 * seed.ts — Seeds capability matrix, providers, models, and guardrail settings.
 * All operations are idempotent (safe to run multiple times).
 *
 * POST /ai/seed/all         — seed everything
 * POST /ai/seed/capabilities — seed capability matrix only (requires providers+models exist)
 * POST /ai/seed/guardrails  — seed guardrail settings only
 */

import { Router } from "express";
import { eq, sql, count } from "drizzle-orm";
import {
  db,
  aiProvidersTable,
  aiModelsTable,
  aiCapabilitiesTable,
  aiSettingsTable,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

// ── Static seed data ─────────────────────────────────────────────────────────

const PROVIDERS_SEED = [
  { name: "OpenAI", slug: "openai", baseUrl: "https://api.openai.com/v1", apiKeyEnvVar: "OPENAI_API_KEY" },
  { name: "Anthropic", slug: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKeyEnvVar: "ANTHROPIC_API_KEY" },
  { name: "Google Gemini", slug: "google-gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKeyEnvVar: "GEMINI_API_KEY" },
  { name: "Replicate", slug: "replicate", baseUrl: "https://api.replicate.com/v1", apiKeyEnvVar: "REPLICATE_API_TOKEN" },
] as const;

interface ModelSeed {
  providerSlug: string;
  name: string;
  modelId: string;
  capabilities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;
  costPerInputToken: string | null;
  costPerOutputToken: string | null;
}

const MODELS_SEED: ModelSeed[] = [
  // OpenAI
  { providerSlug: "openai", name: "GPT-4o", modelId: "gpt-4o", capabilities: ["text", "vision", "function-calling"], contextWindow: 128000, maxOutputTokens: 4096, costPerInputToken: "0.00000250", costPerOutputToken: "0.00001000" },
  { providerSlug: "openai", name: "GPT-4o Mini", modelId: "gpt-4o-mini", capabilities: ["text", "vision", "function-calling"], contextWindow: 128000, maxOutputTokens: 16384, costPerInputToken: "0.00000015", costPerOutputToken: "0.00000060" },
  { providerSlug: "openai", name: "o4-mini", modelId: "o4-mini", capabilities: ["text", "reasoning"], contextWindow: 128000, maxOutputTokens: 65536, costPerInputToken: "0.00000110", costPerOutputToken: "0.00000440" },
  // Anthropic
  { providerSlug: "anthropic", name: "Claude 3.5 Sonnet", modelId: "claude-3-5-sonnet-20241022", capabilities: ["text", "vision", "function-calling"], contextWindow: 200000, maxOutputTokens: 8096, costPerInputToken: "0.00000300", costPerOutputToken: "0.00001500" },
  { providerSlug: "anthropic", name: "Claude 3 Haiku", modelId: "claude-3-haiku-20240307", capabilities: ["text", "vision", "function-calling"], contextWindow: 200000, maxOutputTokens: 4096, costPerInputToken: "0.00000025", costPerOutputToken: "0.00000125" },
  // Google
  { providerSlug: "google-gemini", name: "Gemini 1.5 Pro", modelId: "gemini-1.5-pro-latest", capabilities: ["text", "vision", "function-calling"], contextWindow: 2000000, maxOutputTokens: 8192, costPerInputToken: "0.00000125", costPerOutputToken: "0.00000375" },
  { providerSlug: "google-gemini", name: "Gemini 1.5 Flash", modelId: "gemini-1.5-flash-latest", capabilities: ["text", "vision", "function-calling"], contextWindow: 1000000, maxOutputTokens: 8192, costPerInputToken: "0.00000000750", costPerOutputToken: "0.00000003000" },
  // Replicate
  { providerSlug: "replicate", name: "FLUX.1 Schnell", modelId: "black-forest-labs/flux-schnell", capabilities: ["image-generation"], contextWindow: null, maxOutputTokens: null, costPerInputToken: null, costPerOutputToken: null },
  { providerSlug: "replicate", name: "FLUX.1 Dev", modelId: "black-forest-labs/flux-dev", capabilities: ["image-generation"], contextWindow: null, maxOutputTokens: null, costPerInputToken: null, costPerOutputToken: null },
];

// [modelId, skill, accuracy, speed, cost, maxContext, supportsImage, supportsJson, supportsTool, supportsStream, priority]
type CapabilityRow = [string, string, number, number, number, number, boolean, boolean, boolean, boolean, number];

const CAPABILITY_MATRIX: CapabilityRow[] = [
  // GPT-4o — strong generalist
  ["gpt-4o", "orchestrator",       92, 75, 60, 128000, false, true, true, true, 90],
  ["gpt-4o", "branding",           90, 75, 60, 128000, false, true, true, true, 88],
  ["gpt-4o", "positioning",        88, 75, 60, 128000, false, true, true, true, 86],
  ["gpt-4o", "copywriting",        90, 75, 60, 128000, false, true, true, true, 88],
  ["gpt-4o", "creative_direction", 90, 75, 60, 128000, true,  true, true, true, 88],
  ["gpt-4o", "quality_control",    88, 75, 60, 128000, false, true, true, true, 86],
  ["gpt-4o", "summarization",      85, 80, 60, 128000, false, true, true, true, 80],
  ["gpt-4o", "document_review",    88, 75, 60, 128000, false, true, true, true, 85],

  // GPT-4o Mini — fast, cheap
  ["gpt-4o-mini", "orchestrator",       80, 90, 90, 128000, false, true, true, true, 75],
  ["gpt-4o-mini", "branding",           78, 90, 90, 128000, false, true, true, true, 72],
  ["gpt-4o-mini", "positioning",        76, 90, 90, 128000, false, true, true, true, 70],
  ["gpt-4o-mini", "copywriting",        80, 90, 90, 128000, false, true, true, true, 75],
  ["gpt-4o-mini", "creative_direction", 78, 90, 90, 128000, false, true, true, true, 72],
  ["gpt-4o-mini", "quality_control",    76, 90, 90, 128000, false, true, true, true, 70],
  ["gpt-4o-mini", "summarization",      85, 92, 92, 128000, false, true, true, true, 85],
  ["gpt-4o-mini", "document_review",    78, 90, 90, 128000, false, true, true, true, 72],

  // o4-mini — reasoning specialist
  ["o4-mini", "orchestrator",       88, 68, 75, 128000, false, true, true, false, 82],
  ["o4-mini", "branding",           82, 68, 75, 128000, false, true, true, false, 75],
  ["o4-mini", "positioning",        90, 68, 75, 128000, false, true, true, false, 86],
  ["o4-mini", "copywriting",        84, 68, 75, 128000, false, true, true, false, 78],
  ["o4-mini", "creative_direction", 82, 68, 75, 128000, false, true, true, false, 75],
  ["o4-mini", "quality_control",    92, 68, 75, 128000, false, true, true, false, 90],
  ["o4-mini", "summarization",      85, 70, 75, 128000, false, true, true, false, 78],
  ["o4-mini", "document_review",    90, 68, 75, 128000, false, true, true, false, 86],

  // Claude 3.5 Sonnet — best for creative/writing
  ["claude-3-5-sonnet-20241022", "orchestrator",       93, 72, 55, 200000, false, true, true, true, 92],
  ["claude-3-5-sonnet-20241022", "branding",           95, 72, 55, 200000, false, true, true, true, 94],
  ["claude-3-5-sonnet-20241022", "positioning",        94, 72, 55, 200000, false, true, true, true, 93],
  ["claude-3-5-sonnet-20241022", "copywriting",        96, 72, 55, 200000, false, true, true, true, 95],
  ["claude-3-5-sonnet-20241022", "creative_direction", 94, 72, 55, 200000, true,  true, true, true, 93],
  ["claude-3-5-sonnet-20241022", "quality_control",    95, 72, 55, 200000, false, true, true, true, 94],
  ["claude-3-5-sonnet-20241022", "summarization",      90, 72, 55, 200000, false, true, true, true, 86],
  ["claude-3-5-sonnet-20241022", "document_review",    95, 72, 55, 200000, false, true, true, true, 94],

  // Claude 3 Haiku — fast and cheap
  ["claude-3-haiku-20240307", "orchestrator",       78, 93, 92, 200000, false, true, true, true, 72],
  ["claude-3-haiku-20240307", "branding",           76, 93, 92, 200000, false, true, true, true, 70],
  ["claude-3-haiku-20240307", "positioning",        74, 93, 92, 200000, false, true, true, true, 68],
  ["claude-3-haiku-20240307", "copywriting",        78, 93, 92, 200000, false, true, true, true, 72],
  ["claude-3-haiku-20240307", "creative_direction", 74, 93, 92, 200000, false, true, true, true, 68],
  ["claude-3-haiku-20240307", "quality_control",    76, 93, 92, 200000, false, true, true, true, 70],
  ["claude-3-haiku-20240307", "summarization",      88, 94, 95, 200000, false, true, true, true, 88],
  ["claude-3-haiku-20240307", "document_review",    76, 93, 92, 200000, false, true, true, true, 70],

  // Gemini 1.5 Pro — massive context
  ["gemini-1.5-pro-latest", "orchestrator",       88, 72, 72, 2000000, false, true, true, true, 85],
  ["gemini-1.5-pro-latest", "branding",           86, 72, 72, 2000000, false, true, true, true, 83],
  ["gemini-1.5-pro-latest", "positioning",        85, 72, 72, 2000000, false, true, true, true, 82],
  ["gemini-1.5-pro-latest", "copywriting",        84, 72, 72, 2000000, false, true, true, true, 80],
  ["gemini-1.5-pro-latest", "creative_direction", 86, 72, 72, 2000000, true,  true, true, true, 83],
  ["gemini-1.5-pro-latest", "quality_control",    85, 72, 72, 2000000, false, true, true, true, 82],
  ["gemini-1.5-pro-latest", "summarization",      90, 74, 72, 2000000, false, true, true, true, 87],
  ["gemini-1.5-pro-latest", "document_review",    92, 72, 72, 2000000, false, true, true, true, 90],

  // Gemini 1.5 Flash — fastest, cheapest
  ["gemini-1.5-flash-latest", "orchestrator",       78, 95, 96, 1000000, false, true, true, true, 72],
  ["gemini-1.5-flash-latest", "branding",           74, 95, 96, 1000000, false, true, true, true, 68],
  ["gemini-1.5-flash-latest", "positioning",        72, 95, 96, 1000000, false, true, true, true, 66],
  ["gemini-1.5-flash-latest", "copywriting",        74, 95, 96, 1000000, false, true, true, true, 68],
  ["gemini-1.5-flash-latest", "creative_direction", 72, 95, 96, 1000000, false, true, true, true, 66],
  ["gemini-1.5-flash-latest", "quality_control",    74, 95, 96, 1000000, false, true, true, true, 68],
  ["gemini-1.5-flash-latest", "summarization",      85, 96, 97, 1000000, false, true, true, true, 85],
  ["gemini-1.5-flash-latest", "document_review",    76, 95, 96, 1000000, false, true, true, true, 70],

  // FLUX.1 Schnell — image generation, very fast
  ["black-forest-labs/flux-schnell", "image_generation", 82, 96, 85, 0, true, false, false, false, 90],

  // FLUX.1 Dev — image generation, higher quality
  ["black-forest-labs/flux-dev", "image_generation", 90, 72, 72, 0, true, false, false, false, 85],
];

const GUARDRAIL_SETTINGS = [
  { key: "guardrail.max_cost_per_workflow",         value: "5.00",   valueType: "number",  category: "guardrail", description: "Maximum estimated cost (USD) per workflow run. 0 = unlimited." },
  { key: "guardrail.max_cost_per_request",          value: "0.50",   valueType: "number",  category: "guardrail", description: "Maximum estimated cost (USD) per single AI request." },
  { key: "guardrail.max_retry_per_provider",        value: "3",      valueType: "number",  category: "guardrail", description: "Maximum retry attempts per provider on failure." },
  { key: "guardrail.provider_timeout_ms",           value: "30000",  valueType: "number",  category: "guardrail", description: "Timeout in milliseconds for a single provider request." },
  { key: "guardrail.disable_provider_on_error_rate", value: "0.5",  valueType: "number",  category: "guardrail", description: "Disable a provider when its 24h error rate exceeds this (0–1). 0 = never." },
  { key: "guardrail.fallback_enabled",              value: "true",   valueType: "boolean", category: "guardrail", description: "Enable fallback to secondary providers on primary failure." },
];

// ── Helper: seed providers ────────────────────────────────────────────────────

async function seedProviders(): Promise<Map<string, number>> {
  const providerIdMap = new Map<string, number>();
  for (const p of PROVIDERS_SEED) {
    const [existing] = await db
      .select({ id: aiProvidersTable.id })
      .from(aiProvidersTable)
      .where(eq(aiProvidersTable.slug, p.slug));

    if (existing) {
      providerIdMap.set(p.slug, existing.id);
    } else {
      const [inserted] = await db
        .insert(aiProvidersTable)
        .values({ name: p.name, slug: p.slug, baseUrl: p.baseUrl, apiKeyEnvVar: p.apiKeyEnvVar, isActive: true })
        .returning({ id: aiProvidersTable.id });
      providerIdMap.set(p.slug, inserted.id);
    }
  }
  return providerIdMap;
}

// ── Helper: seed models ───────────────────────────────────────────────────────

async function seedModels(providerIdMap: Map<string, number>): Promise<Map<string, number>> {
  const modelIdMap = new Map<string, number>(); // modelId string → DB integer id
  for (const m of MODELS_SEED) {
    const providerId = providerIdMap.get(m.providerSlug);
    if (!providerId) continue;

    const [existing] = await db
      .select({ id: aiModelsTable.id })
      .from(aiModelsTable)
      .where(eq(aiModelsTable.modelId, m.modelId));

    if (existing) {
      modelIdMap.set(m.modelId, existing.id);
    } else {
      const [inserted] = await db
        .insert(aiModelsTable)
        .values({
          providerId,
          name: m.name,
          modelId: m.modelId,
          capabilities: m.capabilities,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          costPerInputToken: m.costPerInputToken,
          costPerOutputToken: m.costPerOutputToken,
          isActive: true,
        })
        .returning({ id: aiModelsTable.id });
      modelIdMap.set(m.modelId, inserted.id);
    }
  }
  return modelIdMap;
}

// ── Helper: seed capabilities ─────────────────────────────────────────────────

async function seedCapabilities(modelIdMap: Map<string, number>, reset: boolean): Promise<{ skipped: boolean; count: number }> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(aiCapabilitiesTable);

  if (Number(total) > 0 && !reset) {
    return { skipped: true, count: Number(total) };
  }

  if (reset) {
    await db.delete(aiCapabilitiesTable);
  }

  let inserted = 0;
  for (const [modelId, skill, accuracy, speed, cost, maxContext, supportsImage, supportsJson, supportsTool, supportsStream, priority] of CAPABILITY_MATRIX) {
    const dbModelId = modelIdMap.get(modelId);
    if (!dbModelId) continue;

    await db.insert(aiCapabilitiesTable).values({
      modelId: dbModelId,
      skill,
      accuracyScore: String(accuracy),
      speedScore: String(speed),
      costScore: String(cost),
      maxContext,
      supportsImage,
      supportsJson,
      supportsTool,
      supportsStream,
      priority,
      status: priority === 0 ? "inactive" : "active",
    });
    inserted++;
  }

  return { skipped: false, count: inserted };
}

// ── Helper: seed guardrails ───────────────────────────────────────────────────

async function seedGuardrails(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const s of GUARDRAIL_SETTINGS) {
    const [existing] = await db
      .select({ id: aiSettingsTable.id })
      .from(aiSettingsTable)
      .where(eq(aiSettingsTable.key, s.key));

    if (!existing) {
      await db.insert(aiSettingsTable).values(s);
      inserted++;
    } else {
      skipped++;
    }
  }
  return { inserted, skipped };
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post("/ai/seed/guardrails", async (_req, res): Promise<void> => {
  const result = await seedGuardrails();
  await logAudit("seed", "guardrails", "system", "ai_settings", "success", result);
  res.json({ ok: true, guardrails: result });
});

router.post("/ai/seed/capabilities", async (req, res): Promise<void> => {
  const reset = req.query.reset === "true";
  const providerIdMap = await seedProviders();
  const modelIdMap = await seedModels(providerIdMap);
  const caps = await seedCapabilities(modelIdMap, reset);
  await logAudit("seed", "capabilities", "system", "ai_capabilities", "success", caps);
  res.json({ ok: true, capabilities: caps, providers: providerIdMap.size, models: modelIdMap.size });
});

router.post("/ai/seed/all", async (req, res): Promise<void> => {
  const reset = req.query.reset === "true";
  const providerIdMap = await seedProviders();
  const modelIdMap = await seedModels(providerIdMap);
  const caps = await seedCapabilities(modelIdMap, reset);
  const guardrails = await seedGuardrails();

  await logAudit("seed", "all", "system", "system", "success", {
    providers: providerIdMap.size,
    models: modelIdMap.size,
    capabilities: caps,
    guardrails,
  });

  res.json({
    ok: true,
    providers: providerIdMap.size,
    models: modelIdMap.size,
    capabilities: caps,
    guardrails,
  });
});

export default router;
