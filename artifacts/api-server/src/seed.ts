/**
 * Seed script — idempotent.
 * Run: pnpm --filter @workspace/api-server run seed
 *
 * Seeds:
 *  - AI Providers (OpenAI, Anthropic, Google Gemini, Replicate)
 *  - AI Models per provider
 *  - Brand Strategist system prompt
 *  - Brand Strategist agent + capabilities
 */

import { db } from "@workspace/db";
import {
  aiProvidersTable,
  aiModelsTable,
  aiPromptsTable,
  aiAgentsTable,
  aiAgentCapabilitiesTable,
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

  // OpenAI
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

  // Anthropic
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

  // Google Gemini
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

  // Replicate
  console.log("  Replicate:");
  await upsertModel({
    providerId: providers.replicate.id,
    name: "FLUX.1 Schnell",
    modelId: "black-forest-labs/flux-schnell",
    capabilities: ["image-generation", "image"],
    contextWindow: undefined,
    maxOutputTokens: undefined,
    isActive: true,
  });

  await upsertModel({
    providerId: providers.replicate.id,
    name: "FLUX.1 Dev",
    modelId: "black-forest-labs/flux-dev",
    capabilities: ["image-generation", "image"],
    contextWindow: undefined,
    maxOutputTokens: undefined,
    isActive: false, // off by default — higher cost
  });
}

// ─── Brand Strategist ─────────────────────────────────────────────────────────

const BRAND_STRATEGIST_SYSTEM_PROMPT = `You are an expert AI Brand Strategist with deep expertise in brand development, positioning, and strategic communications.

Your core competencies:
- Brand Strategy & Architecture: Define brand vision, mission, and values that resonate with target markets
- Brand Positioning: Craft differentiated positioning statements and competitive frameworks
- Target Market & Persona: Identify and articulate ideal customer profiles, psychographics, and behavioral patterns
- Unique Selling Proposition (USP): Uncover and sharpen what makes a brand truly distinct
- Brand Voice & Tone: Develop authentic communication styles across all channels
- Brand Guidelines: Create comprehensive guidelines covering visual identity principles, messaging, and usage rules

When responding:
1. Ask clarifying questions when the brief is incomplete
2. Provide structured, actionable outputs (frameworks, matrices, templates)
3. Back recommendations with market reasoning and competitive insight
4. Deliver outputs in clear sections with headings
5. Be direct and confident — you are a strategic partner, not a yes-man

Output format preferences:
- Use markdown headers, bullet points, and tables for clarity
- Include a "Strategic Rationale" section explaining the reasoning
- Provide 2–3 alternatives when proposing options so the client can choose
- End with "Recommended Next Steps" for each deliverable`;

async function seedBrandStrategist(openaiModelId: number) {
  console.log("\n🎯 Seeding Brand Strategist agent...");

  // Prompt
  let promptId: number;
  const [existingPrompt] = await db
    .select()
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.name, "Brand Strategist System Prompt"));

  if (existingPrompt) {
    console.log("  ↩ System prompt already exists");
    promptId = existingPrompt.id;
  } else {
    const [prompt] = await db
      .insert(aiPromptsTable)
      .values({
        name: "Brand Strategist System Prompt",
        description: "Core system prompt for the AI Brand Strategist agent",
        content: BRAND_STRATEGIST_SYSTEM_PROMPT,
        category: "system",
        variables: [],
        tags: ["brand", "strategy", "system-prompt"],
        isActive: true,
      })
      .returning();
    promptId = prompt.id;
    console.log("  ✓ Seeded Brand Strategist system prompt");
  }

  // Agent
  let agentId: number;
  const [existingAgent] = await db
    .select()
    .from(aiAgentsTable)
    .where(eq(aiAgentsTable.slug, "brand-strategist"));

  if (existingAgent) {
    console.log("  ↩ Agent already exists");
    agentId = existingAgent.id;
  } else {
    const [agent] = await db
      .insert(aiAgentsTable)
      .values({
        name: "AI Brand Strategist",
        slug: "brand-strategist",
        role: "Brand Strategist",
        description:
          "An expert AI brand strategist that helps define positioning, USPs, target personas, brand voice, and complete brand guidelines.",
        modelId: openaiModelId,
        priority: 10,
        temperature: "0.75",
        maxTokens: 4096,
        status: "active",
        allowedTools: [],
        version: "1.0.0",
        owner: "platform",
        metadata: {
          systemPrompt: BRAND_STRATEGIST_SYSTEM_PROMPT,
          promptId,
        },
      })
      .returning();
    agentId = agent.id;
    console.log("  ✓ Seeded Brand Strategist agent");
  }

  // Capabilities
  const capabilities = [
    { name: "Brand Strategy", description: "Define brand vision, mission, and strategic direction", category: "strategy", sortOrder: 0 },
    { name: "Brand Positioning", description: "Craft differentiated positioning and competitive frameworks", category: "strategy", sortOrder: 1 },
    { name: "Target Market & Personas", description: "Identify ideal customer profiles and psychographic segments", category: "research", sortOrder: 2 },
    { name: "Unique Selling Proposition", description: "Sharpen what makes a brand truly distinct", category: "strategy", sortOrder: 3 },
    { name: "Brand Voice & Tone", description: "Develop authentic communication styles across all channels", category: "creative", sortOrder: 4 },
    { name: "Brand Guidelines", description: "Create comprehensive brand identity and usage guidelines", category: "creative", sortOrder: 5 },
    { name: "Competitive Analysis", description: "Analyze competitive landscape and identify white-space opportunities", category: "research", sortOrder: 6 },
  ];

  const existingCaps = await db
    .select()
    .from(aiAgentCapabilitiesTable)
    .where(eq(aiAgentCapabilitiesTable.agentId, agentId));

  if (existingCaps.length > 0) {
    console.log("  ↩ Capabilities already seeded");
  } else {
    for (const cap of capabilities) {
      await db.insert(aiAgentCapabilitiesTable).values({ ...cap, agentId });
    }
    console.log(`  ✓ Seeded ${capabilities.length} capabilities`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Starting seed...");

  const providers = await seedProviders();
  await seedModels(providers);

  // Find the GPT-4o model id for the Brand Strategist
  const [gpt4o] = await db
    .select()
    .from(aiModelsTable)
    .where(and(eq(aiModelsTable.modelId, "gpt-4o"), eq(aiModelsTable.providerId, providers.openai.id)));

  if (!gpt4o) {
    throw new Error("GPT-4o model not found after seeding — something went wrong");
  }

  await seedBrandStrategist(gpt4o.id);

  console.log("\n✅ Seed complete!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
