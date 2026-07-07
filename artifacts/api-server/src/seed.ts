/**
 * Seed script — idempotent.
 * Run: pnpm --filter @workspace/api-server run seed
 *
 * Seeds:
 *  - AI Providers (OpenAI, Anthropic, Google Gemini, Replicate)
 *  - AI Models per provider
 *  - Core workflow definitions
 */

import { db } from "@workspace/db";
import {
  aiProvidersTable,
  aiModelsTable,
  aiWorkflowsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function upsertProvider(data: {
  name: string;
  slug: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  isActive: boolean;
}) {
  const [existing] = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.slug, data.slug));

  if (existing) {
    console.log(`  ↩ Provider already exists: ${data.name}`);
    return existing;
  }

  const [row] = await db.insert(aiProvidersTable).values(data).returning();
  console.log(`  ✓ Seeded provider: ${data.name}`);
  return row;
}

async function upsertModel(data: {
  providerId: number;
  name: string;
  modelId: string;
  capabilities: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  costPerInputToken?: string;
  costPerOutputToken?: string;
  isActive: boolean;
}) {
  const [existing] = await db
    .select()
    .from(aiModelsTable)
    .where(
      and(
        eq(aiModelsTable.providerId, data.providerId),
        eq(aiModelsTable.modelId, data.modelId),
      ),
    );

  if (existing) {
    console.log(`    ↩ Model already exists: ${data.name}`);
    return existing;
  }

  const [row] = await db.insert(aiModelsTable).values(data).returning();
  console.log(`    ✓ Seeded model: ${data.name}`);
  return row;
}

// ─── Providers ───────────────────────────────────────────────────────────────

async function seedProviders() {
  console.log("\n📦 Seeding providers...");

  const openai = await upsertProvider({
    name: "OpenAI",
    slug: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
    isActive: true,
  });

  const anthropic = await upsertProvider({
    name: "Anthropic",
    slug: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    isActive: true,
  });

  const google = await upsertProvider({
    name: "Google Gemini",
    slug: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnvVar: "GEMINI_API_KEY",
    isActive: true,
  });

  const replicate = await upsertProvider({
    name: "Replicate",
    slug: "replicate",
    baseUrl: "https://api.replicate.com/v1",
    apiKeyEnvVar: "REPLICATE_API_TOKEN",
    isActive: true,
  });

  return { openai, anthropic, google, replicate };
}

// ─── Models ──────────────────────────────────────────────────────────────────

async function seedModels(providers: {
  openai: { id: number };
  anthropic: { id: number };
  google: { id: number };
  replicate: { id: number };
}) {
  console.log("\n🤖 Seeding models...");

  console.log("  OpenAI:");
  await upsertModel({
    providerId: providers.openai.id,
    name: "GPT-4o",
    modelId: "gpt-4o",
    capabilities: ["text", "orchestrator", "brief", "copywriting", "analysis", "code"],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPerInputToken: "0.0000025",
    costPerOutputToken: "0.0000100",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.openai.id,
    name: "GPT-4o Mini",
    modelId: "gpt-4o-mini",
    capabilities: ["text", "fast", "copywriting", "cheap"],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPerInputToken: "0.00000015",
    costPerOutputToken: "0.00000060",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.openai.id,
    name: "o4-mini",
    modelId: "o4-mini",
    capabilities: ["text", "reasoning", "analysis", "code"],
    contextWindow: 128000,
    maxOutputTokens: 65536,
    costPerInputToken: "0.0000011",
    costPerOutputToken: "0.0000044",
    isActive: true,
  });

  console.log("  Anthropic:");
  await upsertModel({
    providerId: providers.anthropic.id,
    name: "Claude 3.5 Sonnet",
    modelId: "claude-3-5-sonnet-20241022",
    capabilities: ["text", "document", "review", "analysis", "copywriting"],
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.0000030",
    costPerOutputToken: "0.0000150",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.anthropic.id,
    name: "Claude 3 Haiku",
    modelId: "claude-3-haiku-20240307",
    capabilities: ["text", "fast", "cheap", "document"],
    contextWindow: 200000,
    maxOutputTokens: 4096,
    costPerInputToken: "0.00000025",
    costPerOutputToken: "0.00000125",
    isActive: true,
  });

  console.log("  Google Gemini:");
  await upsertModel({
    providerId: providers.google.id,
    name: "Gemini 1.5 Pro",
    modelId: "gemini-1.5-pro-latest",
    capabilities: ["text", "multimodal", "vision", "document", "analysis"],
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.0000035",
    costPerOutputToken: "0.0000105",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.google.id,
    name: "Gemini 1.5 Flash",
    modelId: "gemini-1.5-flash",
    capabilities: ["text", "fast", "multimodal", "cheap"],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.00000075",
    costPerOutputToken: "0.00000300",
    isActive: true,
  });

  console.log("  Replicate:");
  await upsertModel({
    providerId: providers.replicate.id,
    name: "FLUX.1 Schnell",
    modelId: "black-forest-labs/flux-schnell",
    capabilities: ["image-generation", "image"],
    isActive: true,
  });

  await upsertModel({
    providerId: providers.replicate.id,
    name: "FLUX.1 Dev",
    modelId: "black-forest-labs/flux-dev",
    capabilities: ["image-generation", "image"],
    isActive: false,
  });
}

// ─── Workflows ───────────────────────────────────────────────────────────────

async function seedWorkflows() {
  console.log("\n🔄 Seeding workflows...");

  const workflows = [
    {
      name: "Creative Brief Workflow",
      description: "Full 4-step creative pipeline: Brand Strategy → Creative Direction → Copy Production → Quality Control",
      status: "active" as const,
      steps: [
        { id: "step-1", order: 1, name: "Brand Strategy", type: "llm", description: "Define positioning, USP, and tone of voice" },
        { id: "step-2", order: 2, name: "Creative Direction", type: "llm", description: "Develop concept, colors, and typography" },
        { id: "step-3", order: 3, name: "Copy Production", type: "llm", description: "Produce headlines, captions, and CTAs" },
        { id: "step-4", order: 4, name: "Quality Control", type: "llm", description: "Review all outputs for consistency and quality" },
      ],
      triggerType: "manual" as const,
      tags: ["creative", "brand", "marketing"],
    },
    {
      name: "Document Summary Pipeline",
      description: "Extract, chunk, and summarize long documents using AI",
      status: "active" as const,
      steps: [
        { id: "step-1", order: 1, name: "Extract Text", type: "transform", description: "Extract raw text from document" },
        { id: "step-2", order: 2, name: "Chunk Document", type: "transform", description: "Split into semantic chunks" },
        { id: "step-3", order: 3, name: "Summarize Chunks", type: "llm", description: "Summarize each chunk with AI" },
        { id: "step-4", order: 4, name: "Merge Summary", type: "transform", description: "Combine chunk summaries into final output" },
      ],
      triggerType: "manual" as const,
      tags: ["documents", "summarization"],
    },
    {
      name: "Sentiment Analysis Pipeline",
      description: "Classify and analyze sentiment across batches of text",
      status: "active" as const,
      steps: [
        { id: "step-1", order: 1, name: "Preprocess Text", type: "transform", description: "Clean and normalize input text" },
        { id: "step-2", order: 2, name: "Classify Sentiment", type: "llm", description: "Run sentiment classification" },
        { id: "step-3", order: 3, name: "Aggregate Results", type: "transform", description: "Aggregate scores into summary report" },
      ],
      triggerType: "schedule" as const,
      tags: ["nlp", "sentiment", "analytics"],
    },
  ];

  for (const wf of workflows) {
    const [existing] = await db
      .select()
      .from(aiWorkflowsTable)
      .where(eq(aiWorkflowsTable.name, wf.name));

    if (existing) {
      console.log(`  ↩ Workflow already exists: ${wf.name}`);
    } else {
      await db.insert(aiWorkflowsTable).values(wf);
      console.log(`  ✓ Seeded workflow: ${wf.name}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Starting seed...");

  const providers = await seedProviders();
  await seedModels(providers);
  await seedWorkflows();

  console.log("\n✅ Seed complete!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
