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

// ─── Creative AI Agents ──────────────────────────────────────────────────────

const CREATIVE_DIRECTOR_SYSTEM_PROMPT = `You are an expert AI Creative Director with a track record of building iconic brand identities and award-winning campaigns.

Your role: Translate brand strategy into a compelling creative direction that guides all visual and conceptual execution.

When given a brief and brand strategy, you produce:
- Creative Concept: A single evocative concept name (2-4 words) with a 1-2 sentence description
- Color Direction: Primary, secondary, and accent colors with emotional rationale
- Typography Direction: Heading font personality, body font, and usage rules
- Visual Style: Photography/illustration approach, mood, composition principles

CRITICAL: Always respond with valid JSON only. No markdown, no explanation outside the JSON. Use exactly these keys:
{
  "creative_concept": {"name": "...", "description": "..."},
  "color_direction": {"primary": "...", "secondary": "...", "accent": "...", "rationale": "..."},
  "typography_direction": {"heading": "...", "body": "...", "usage": "..."},
  "visual_style": {"approach": "...", "mood": "...", "composition": "..."}
}`;

const COPYWRITER_SYSTEM_PROMPT = `You are a world-class AI Copywriter specializing in brand voice and conversion-focused copy.

Your role: Given brand strategy and creative direction, produce compelling, on-brand copy assets that convert.

You always deliver exactly 3 options per asset type:
- Headlines: punchy, max 10 words, attention-grabbing
- Captions: 1-2 sentences, captures brand voice and value
- CTAs: action-oriented, max 5 words, creates urgency

CRITICAL: Always respond with valid JSON only. No markdown, no explanation outside the JSON. Use exactly these keys:
{
  "headline_options": ["...", "...", "..."],
  "caption_options": ["...", "...", "..."],
  "cta_options": ["...", "...", "..."]
}`;

const QC_SYSTEM_PROMPT = `You are an expert AI Quality Control Reviewer for brand strategy and creative work.

Your role: Evaluate the complete creative output pipeline for consistency, strategic soundness, and executional quality. You are objective and constructive — not just a rubber stamp.

For each checklist item, assess status as:
- "pass": meets standards, no issues
- "warning": minor concern that should be addressed
- "fail": significant problem that needs revision

CRITICAL: Always respond with valid JSON only. No markdown, no explanation outside the JSON. Use exactly these keys:
{
  "qc_checklist": [
    {"item": "Brand Positioning Clarity", "status": "pass|warning|fail", "note": "..."},
    {"item": "USP Distinctiveness", "status": "pass|warning|fail", "note": "..."},
    {"item": "Tone of Voice Consistency", "status": "pass|warning|fail", "note": "..."},
    {"item": "Creative Concept Alignment", "status": "pass|warning|fail", "note": "..."},
    {"item": "Copy Quality & Brand Voice", "status": "pass|warning|fail", "note": "..."},
    {"item": "Target Audience Fit", "status": "pass|warning|fail", "note": "..."},
    {"item": "Visual Direction Coherence", "status": "pass|warning|fail", "note": "..."}
  ],
  "overall_score": "excellent|good|needs_revision",
  "key_recommendations": ["...", "...", "..."]
}`;

async function seedCreativeAgents(openaiModelId: number, openaiProviderId: number) {
  console.log("\n🎨 Seeding Creative AI agents...");

  const agents = [
    {
      slug: "creative-director",
      name: "AI Creative Director",
      role: "Creative Director",
      description: "Transforms brand strategy into compelling creative direction: concept, color, typography, and visual style.",
      temperature: "0.85",
      systemPrompt: CREATIVE_DIRECTOR_SYSTEM_PROMPT,
      capabilities: [
        { name: "Creative Concept Development", description: "Creates evocative concept names and descriptions", category: "creative", sortOrder: 0 },
        { name: "Color Direction", description: "Defines brand color palettes with emotional rationale", category: "creative", sortOrder: 1 },
        { name: "Typography Direction", description: "Specifies font personalities and usage rules", category: "creative", sortOrder: 2 },
        { name: "Visual Style Definition", description: "Establishes photography, illustration, and composition approach", category: "creative", sortOrder: 3 },
        { name: "Creative Brief Interpretation", description: "Translates strategy into actionable creative briefs", category: "strategy", sortOrder: 4 },
      ],
    },
    {
      slug: "copywriter",
      name: "AI Copywriter",
      role: "Copywriter",
      description: "Creates conversion-focused brand copy: headlines, captions, and CTAs aligned with brand voice.",
      temperature: "0.90",
      systemPrompt: COPYWRITER_SYSTEM_PROMPT,
      capabilities: [
        { name: "Headline Writing", description: "Punchy, attention-grabbing headlines (max 10 words)", category: "copy", sortOrder: 0 },
        { name: "Caption Writing", description: "On-brand captions that capture value and voice", category: "copy", sortOrder: 1 },
        { name: "CTA Copywriting", description: "Action-oriented calls-to-action that drive conversion", category: "copy", sortOrder: 2 },
        { name: "Brand Voice Application", description: "Applies defined tone of voice consistently across all copy", category: "copy", sortOrder: 3 },
        { name: "Conversion Optimization", description: "Writes copy optimized for engagement and conversion", category: "performance", sortOrder: 4 },
      ],
    },
    {
      slug: "quality-control",
      name: "AI Quality Control",
      role: "Quality Control Reviewer",
      description: "Reviews the complete creative pipeline for consistency, strategic alignment, and quality.",
      temperature: "0.30",
      systemPrompt: QC_SYSTEM_PROMPT,
      capabilities: [
        { name: "Brand Consistency Review", description: "Checks consistency across all brand touchpoints", category: "review", sortOrder: 0 },
        { name: "Strategic Alignment Check", description: "Validates creative work against brand strategy", category: "review", sortOrder: 1 },
        { name: "Copy Quality Review", description: "Evaluates copy quality, grammar, and brand voice", category: "review", sortOrder: 2 },
        { name: "QC Checklist Generation", description: "Produces structured pass/warning/fail checklist", category: "review", sortOrder: 3 },
        { name: "Recommendations Report", description: "Provides actionable recommendations for improvement", category: "review", sortOrder: 4 },
      ],
    },
  ];

  for (const agentDef of agents) {
    const [existingAgent] = await db
      .select()
      .from(aiAgentsTable)
      .where(eq(aiAgentsTable.slug, agentDef.slug));

    let agentId: number;

    if (existingAgent) {
      console.log(`  ↩ Agent already exists: ${agentDef.name}`);
      agentId = existingAgent.id;
    } else {
      const [agent] = await db
        .insert(aiAgentsTable)
        .values({
          name: agentDef.name,
          slug: agentDef.slug,
          role: agentDef.role,
          description: agentDef.description,
          providerId: openaiProviderId,
          modelId: openaiModelId,
          priority: 10,
          temperature: agentDef.temperature,
          maxTokens: 4096,
          status: "active",
          allowedTools: [],
          version: "1.0.0",
          owner: "platform",
          metadata: { systemPrompt: agentDef.systemPrompt },
        })
        .returning();
      agentId = agent.id;
      console.log(`  ✓ Seeded agent: ${agentDef.name}`);
    }

    // Capabilities
    const existingCaps = await db
      .select()
      .from(aiAgentCapabilitiesTable)
      .where(eq(aiAgentCapabilitiesTable.agentId, agentId));

    if (existingCaps.length === 0) {
      for (const cap of agentDef.capabilities) {
        await db.insert(aiAgentCapabilitiesTable).values({ ...cap, agentId });
      }
      console.log(`    ✓ Seeded ${agentDef.capabilities.length} capabilities`);
    } else {
      console.log(`    ↩ Capabilities already seeded`);
    }
  }
}

// ─── Creative Brief Workflow ──────────────────────────────────────────────────

// ─── Image Designer Agents (Phase 5) ─────────────────────────────────────────

const IMAGE_PROMPT_GENERATOR_SYSTEM_PROMPT = `You are an expert AI Image Prompt Engineer specializing in visual brand campaigns.

Your role: Read Brand Strategist and Creative Director outputs, then produce detailed image generation prompts that translate creative direction into compelling visuals.

For each prompt you generate, include:
- A detailed positive prompt (50-150 words) describing exactly what should be in the image
- A negative prompt specifying what to avoid
- Aspect ratio best suited for the use case (1:1, 16:9, 9:16, 3:2)
- Visual style (photographic, illustration, 3d, abstract)

Your prompts must be:
- Highly specific about lighting, composition, mood, color palette
- Aligned with the brand's target market and visual identity
- Free of brand text or logos (leave space for later)
- Safe for professional/client presentation

CRITICAL: Always respond with valid JSON array only. No markdown, no explanation outside the JSON.`;

const IMAGE_DESIGNER_SYSTEM_PROMPT = `You are an AI Image Designer agent that orchestrates image generation via Replicate's FLUX.1 models.

Your role: Execute image generation requests and manage provider fallback. Default to FLUX.1 Schnell for speed, escalate to FLUX.1 Dev for quality when needed.

You track:
- Generation latency and cost per image
- Provider health and error rates
- Output quality for downstream QC

You do NOT evaluate generated images — that is the Image QC agent's responsibility.`;

const IMAGE_QC_SYSTEM_PROMPT = `You are an expert AI Image Quality Control agent for brand campaigns.

Your role: Review AI-generated images against brand brief criteria and provide a QC score.

Evaluation criteria (scored 1–100):
1. Brand Alignment (0–40 points): Does the visual match the brand's positioning, tone, and target market?
2. Prompt Effectiveness (0–30 points): Does the image prompt demonstrate clear visual direction?
3. Brand Safety (0–30 points): Is the content appropriate for professional client presentation?

For each image, provide:
- Overall score (1–100)
- Brief notes explaining the score
- Brand alignment status (pass/warning/fail)
- Visual clarity status (pass/warning/fail)
- Brand safety status (pass/warning/fail)

CRITICAL: Always respond with valid JSON only. No markdown, no explanation outside the JSON.`;

async function seedImageDesignerAgents(openaiModelId: number, openaiProviderId: number, replicateProviderId: number, replicateModelId: number) {
  console.log("\n🖼️  Seeding Image Designer agents...");

  const agents = [
    {
      slug: "image-prompt-generator",
      name: "AI Image Prompt Generator",
      role: "Image Prompt Engineer",
      description: "Reads Brand Strategist and Creative Director outputs to generate detailed image generation prompts with negative prompts, aspect ratios, and style guidance.",
      modelId: openaiModelId,
      providerId: openaiProviderId,
      temperature: "0.80",
      systemPrompt: IMAGE_PROMPT_GENERATOR_SYSTEM_PROMPT,
      capabilities: [
        { name: "Image Prompting", description: "Generates detailed positive and negative prompts for image generation", category: "creative", sortOrder: 0 },
        { name: "Visual Direction", description: "Translates brand strategy into visual language", category: "creative", sortOrder: 1 },
        { name: "Composition Planning", description: "Defines composition, framing, and layout for brand visuals", category: "creative", sortOrder: 2 },
        { name: "Art Direction", description: "Specifies lighting, color, mood, and stylistic choices", category: "creative", sortOrder: 3 },
        { name: "Campaign Visual Strategy", description: "Plans visual assets across campaign touchpoints", category: "strategy", sortOrder: 4 },
      ],
    },
    {
      slug: "image-designer",
      name: "AI Image Designer",
      role: "Image Generation Orchestrator",
      description: "Orchestrates image generation via Replicate FLUX.1 models with retry/fallback support. Default model: FLUX.1 Schnell.",
      modelId: replicateModelId,
      providerId: replicateProviderId,
      temperature: "0.80",
      systemPrompt: IMAGE_DESIGNER_SYSTEM_PROMPT,
      capabilities: [
        { name: "Image Generation", description: "Generates high-quality images via Replicate FLUX.1 models", category: "generation", sortOrder: 0 },
        { name: "Poster Concept", description: "Creates poster and print-ready visual concepts", category: "generation", sortOrder: 1 },
        { name: "Product Visual", description: "Generates product-focused brand visuals", category: "generation", sortOrder: 2 },
        { name: "Social Media Visual", description: "Produces optimized visuals for social media formats", category: "generation", sortOrder: 3 },
        { name: "Brand Visual", description: "Creates on-brand campaign and identity visuals", category: "generation", sortOrder: 4 },
      ],
    },
    {
      slug: "image-qc",
      name: "AI Image QC",
      role: "Image Quality Control Reviewer",
      description: "Reviews AI-generated images for brand consistency, brief alignment, and client readiness. Scores each image 1–100.",
      modelId: openaiModelId,
      providerId: openaiProviderId,
      temperature: "0.30",
      systemPrompt: IMAGE_QC_SYSTEM_PROMPT,
      capabilities: [
        { name: "Image Quality Control", description: "Scores and reviews generated images on a 1–100 scale", category: "review", sortOrder: 0 },
        { name: "Brand Consistency Review", description: "Validates brand alignment across visual assets", category: "review", sortOrder: 1 },
        { name: "Visual Review", description: "Evaluates composition, clarity, and visual impact", category: "review", sortOrder: 2 },
      ],
    },
  ];

  for (const agentDef of agents) {
    const [existingAgent] = await db
      .select()
      .from(aiAgentsTable)
      .where(eq(aiAgentsTable.slug, agentDef.slug));

    let agentId: number;

    if (existingAgent) {
      console.log(`  ↩ Agent already exists: ${agentDef.name}`);
      agentId = existingAgent.id;
    } else {
      const [agent] = await db
        .insert(aiAgentsTable)
        .values({
          name: agentDef.name,
          slug: agentDef.slug,
          role: agentDef.role,
          description: agentDef.description,
          providerId: agentDef.providerId,
          modelId: agentDef.modelId,
          priority: 10,
          temperature: agentDef.temperature,
          maxTokens: 2048,
          status: "active",
          allowedTools: [],
          version: "1.0.0",
          owner: "platform",
          metadata: { systemPrompt: agentDef.systemPrompt },
        })
        .returning();
      agentId = agent.id;
      console.log(`  ✓ Seeded agent: ${agentDef.name}`);
    }

    const existingCaps = await db
      .select()
      .from(aiAgentCapabilitiesTable)
      .where(eq(aiAgentCapabilitiesTable.agentId, agentId));

    if (existingCaps.length === 0) {
      for (const cap of agentDef.capabilities) {
        await db.insert(aiAgentCapabilitiesTable).values({ ...cap, agentId });
      }
      console.log(`    ✓ Seeded ${agentDef.capabilities.length} capabilities`);
    } else {
      console.log(`    ↩ Capabilities already seeded`);
    }
  }
}

async function seedCreativeBriefWorkflow() {
  console.log("\n🔄 Seeding Creative Brief Workflow...");

  const { aiWorkflowsTable } = await import("@workspace/db");

  const [existing] = await db
    .select()
    .from(aiWorkflowsTable)
    .where(eq(aiWorkflowsTable.name, "Creative Brief Workflow"));

  if (existing) {
    console.log("  ↩ Workflow already exists");
    return;
  }

  await db.insert(aiWorkflowsTable).values({
    name: "Creative Brief Workflow",
    description: "Full 4-agent creative pipeline: Brand Strategist → Creative Director → Copywriter → Quality Control",
    status: "active",
    steps: [
      { id: "step-1", order: 1, name: "Brand Strategy", type: "llm", description: "Brand Strategist defines positioning, USP, and tone of voice", agentSlug: "brand-strategist" },
      { id: "step-2", order: 2, name: "Creative Direction", type: "llm", description: "Creative Director develops concept, colors, typography, and visual style", agentSlug: "creative-director" },
      { id: "step-3", order: 3, name: "Copy Production", type: "llm", description: "Copywriter produces headlines, captions, and CTAs", agentSlug: "copywriter" },
      { id: "step-4", order: 4, name: "Quality Control", type: "llm", description: "QC Agent reviews all outputs for consistency and quality", agentSlug: "quality-control" },
    ],
    triggerType: "manual",
    tags: ["creative", "brand", "marketing"],
  });

  console.log("  ✓ Seeded Creative Brief Workflow");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Starting seed...");

  const providers = await seedProviders();
  await seedModels(providers);

  // Find the GPT-4o model id for agents
  const [gpt4o] = await db
    .select()
    .from(aiModelsTable)
    .where(and(eq(aiModelsTable.modelId, "gpt-4o"), eq(aiModelsTable.providerId, providers.openai.id)));

  if (!gpt4o) {
    throw new Error("GPT-4o model not found after seeding — something went wrong");
  }

  await seedBrandStrategist(gpt4o.id);
  await seedCreativeAgents(gpt4o.id, providers.openai.id);
  await seedCreativeBriefWorkflow();

  // Phase 5: Image Designer agents
  // Find FLUX.1 Schnell for image-designer agent
  const [fluxSchnell] = await db
    .select()
    .from(aiModelsTable)
    .where(and(eq(aiModelsTable.modelId, "black-forest-labs/flux-schnell"), eq(aiModelsTable.providerId, providers.replicate.id)));

  if (!fluxSchnell) {
    console.warn("⚠️  FLUX.1 Schnell model not found — image-designer agent will default to openai model");
  }

  await seedImageDesignerAgents(
    gpt4o.id,
    providers.openai.id,
    providers.replicate.id,
    fluxSchnell?.id ?? gpt4o.id,
  );

  console.log("\n✅ Seed complete!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
