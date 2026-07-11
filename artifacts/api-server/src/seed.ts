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
  aiDepartmentsTable,
  aiEmployeesTable,
  aiWorkloadTable,
  aiEmployeePerformanceTable,
  aiDecisionLogsTable,
  aiAgentsTable,
  aiAgentCapabilitiesTable,
  aiWorkersTable,
  aiJobsTable,
  aiSchedulesTable,
  aiSkillPackagesTable,
  aiToolPackagesTable,
  aiInstalledPackagesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { computePriorityScore } from "./services/priorityEngine.js";
import { createSchedule } from "./services/aiSchedulerService.js";
import { seedServiceCatalog } from "./seedCatalog.js";
import { seedPortfolioShowcase } from "./seedPortfolio.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function upsertProvider(data: {
  name: string;
  slug: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  isActive: boolean;
}) {
  // True upsert: insert or update all fields on slug conflict.
  // This ensures re-running seed always reflects the latest config (including isActive).
  const [row] = await db
    .insert(aiProvidersTable)
    .values(data)
    .onConflictDoUpdate({
      target: aiProvidersTable.slug,
      set: {
        name: data.name,
        baseUrl: data.baseUrl,
        apiKeyEnvVar: data.apiKeyEnvVar,
        isActive: data.isActive,
        updatedAt: new Date(),
      },
    })
    .returning();
  console.log(`  ✓ Upserted provider: ${data.name} (isActive=${data.isActive})`);
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
    baseUrl: "https://api.anthropic.com/v1",
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

  const mistral = await upsertProvider({
    name: "Mistral AI",
    slug: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnvVar: "MISTRAL_API_KEY",
    isActive: true,
  });

  return { openai, anthropic, google, replicate, mistral };
}

// ─── Models ──────────────────────────────────────────────────────────────────

async function seedModels(providers: {
  openai: { id: number };
  anthropic: { id: number };
  google: { id: number };
  replicate: { id: number };
  mistral: { id: number };
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
    name: "Claude Sonnet 5",
    modelId: "claude-sonnet-5",
    capabilities: ["text", "analysis", "reasoning", "copywriting", "document"],
    contextWindow: 200000,
    maxOutputTokens: 16000,
    costPerInputToken: "0.000003",
    costPerOutputToken: "0.000015",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.anthropic.id,
    name: "Claude Opus 4.8",
    modelId: "claude-opus-4-8",
    capabilities: ["text", "analysis", "reasoning", "document", "code"],
    contextWindow: 200000,
    maxOutputTokens: 32000,
    costPerInputToken: "0.000015",
    costPerOutputToken: "0.000075",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.anthropic.id,
    name: "Claude Haiku 4.5",
    modelId: "claude-haiku-4-5-20251001",
    capabilities: ["text", "fast", "cheap", "copywriting"],
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.0000008",
    costPerOutputToken: "0.000004",
    isActive: true,
  });

  console.log("  Google Gemini:");
  await upsertModel({
    providerId: providers.google.id,
    name: "Gemini 2.5 Pro",
    modelId: "gemini-2.5-pro",
    capabilities: ["text", "multimodal", "vision", "document", "analysis", "reasoning"],
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.00000125",
    costPerOutputToken: "0.00001000",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.google.id,
    name: "Gemini 2.5 Flash",
    modelId: "gemini-2.5-flash",
    capabilities: ["text", "fast", "multimodal", "cheap"],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.00000015",
    costPerOutputToken: "0.00000060",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.google.id,
    name: "Gemini 2.0 Flash",
    modelId: "gemini-2.0-flash",
    capabilities: ["text", "fast", "multimodal"],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.00000010",
    costPerOutputToken: "0.00000040",
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

  console.log("  Mistral AI:");
  await upsertModel({
    providerId: providers.mistral.id,
    name: "Mistral Small",
    modelId: "mistral-small-latest",
    capabilities: ["text", "fast", "cheap", "copywriting"],
    contextWindow: 32000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.000001",
    costPerOutputToken: "0.000003",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.mistral.id,
    name: "Mistral Large",
    modelId: "mistral-large-latest",
    capabilities: ["text", "analysis", "reasoning", "copywriting", "document"],
    contextWindow: 128000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.000003",
    costPerOutputToken: "0.000009",
    isActive: true,
  });

  await upsertModel({
    providerId: providers.mistral.id,
    name: "Codestral",
    modelId: "codestral-latest",
    capabilities: ["text", "code", "analysis"],
    contextWindow: 32000,
    maxOutputTokens: 8192,
    costPerInputToken: "0.000001",
    costPerOutputToken: "0.000003",
    isActive: true,
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

// ─── Phase 4.9: AI Operating Core — Digital Workforce ──────────────────────────

const DEPARTMENTS = [
  { departmentCode: "CREATIVE",  departmentName: "Creative",  description: "Brand strategy, design, and creative production" },
  { departmentCode: "MARKETING", departmentName: "Marketing", description: "Campaigns, social media, and growth marketing" },
  { departmentCode: "FINANCE",   departmentName: "Finance",   description: "Budgeting, invoicing, and financial planning" },
  { departmentCode: "HR",        departmentName: "Human Resources", description: "Recruiting, onboarding, and employee relations" },
  { departmentCode: "LEGAL",     departmentName: "Legal",     description: "Contracts, compliance, and legal review" },
  { departmentCode: "TAX",       departmentName: "Tax",       description: "Tax accounting and regulatory filings" },
  { departmentCode: "LOGISTICS", departmentName: "Logistics", description: "Shipping, supply chain, and fulfillment" },
  { departmentCode: "TRADING",   departmentName: "Trading",   description: "Market analysis and trading operations" },
];

const MANAGERS = [
  { code: "MGR-CREATIVE",  name: "Creative Director",  position: "Creative Director",  dept: "CREATIVE" },
  { code: "MGR-MARKETING", name: "Marketing Director",  position: "Marketing Director", dept: "MARKETING" },
  { code: "MGR-FINANCE",   name: "Finance Manager",     position: "Finance Manager",    dept: "FINANCE" },
  { code: "MGR-HR",        name: "HR Manager",          position: "HR Manager",         dept: "HR" },
  { code: "MGR-LEGAL",     name: "Legal Manager",       position: "Legal Manager",      dept: "LEGAL" },
  { code: "MGR-TAX",       name: "Tax Manager",         position: "Tax Manager",        dept: "TAX" },
  { code: "MGR-LOGISTICS", name: "Logistics Manager",   position: "Logistics Manager",  dept: "LOGISTICS" },
  { code: "MGR-TRADING",   name: "Trading Manager",     position: "Trading Manager",    dept: "TRADING" },
];

async function upsertDepartment(data: typeof DEPARTMENTS[number]) {
  const [existing] = await db
    .select()
    .from(aiDepartmentsTable)
    .where(eq(aiDepartmentsTable.departmentCode, data.departmentCode));

  if (existing) {
    console.log(`  ↩ Department already exists: ${data.departmentName}`);
    return existing;
  }
  const [row] = await db.insert(aiDepartmentsTable).values({ ...data, status: "active" }).returning();
  console.log(`  ✓ Seeded department: ${data.departmentName}`);
  return row;
}

async function upsertEmployee(data: {
  employeeCode: string;
  employeeName: string;
  position: string;
  role: string;
  level: string;
  departmentId: number | null;
  providerId: number;
  modelId: number;
  maxParallelJobs?: number;
  priority?: number;
}) {
  const [existing] = await db
    .select()
    .from(aiEmployeesTable)
    .where(eq(aiEmployeesTable.employeeCode, data.employeeCode));

  if (existing) {
    console.log(`    ↩ Employee already exists: ${data.employeeName}`);
    return existing;
  }

  const [row] = await db
    .insert(aiEmployeesTable)
    .values({
      employeeCode: data.employeeCode,
      employeeName: data.employeeName,
      position: data.position,
      role: data.role,
      level: data.level,
      departmentId: data.departmentId,
      providerId: data.providerId,
      modelId: data.modelId,
      maxParallelJobs: data.maxParallelJobs ?? 3,
      priority: data.priority ?? 50,
      status: "active",
    })
    .returning();

  console.log(`    ✓ Seeded employee: ${data.employeeName} (${data.position})`);
  return row;
}

async function ensureCapacityAndPerformance(employeeId: number) {
  const [existingWorkload] = await db.select().from(aiWorkloadTable).where(eq(aiWorkloadTable.employeeId, employeeId));
  if (!existingWorkload) {
    await db.insert(aiWorkloadTable).values({ employeeId, availability: 100, status: "idle" });
  }

  const [existingPerf] = await db.select().from(aiEmployeePerformanceTable).where(eq(aiEmployeePerformanceTable.employeeId, employeeId));
  if (!existingPerf) {
    await db.insert(aiEmployeePerformanceTable).values({
      employeeId,
      completedProjects: 0,
      successRate: "95.00",
      approvalRate: "90.00",
      qualityScore: "88.00",
      customerRating: "4.5",
      experiencePoints: 100,
      promotionScore: "60.00",
    });
  }
}

async function seedWorkforce(defaultProviderId: number, defaultModelId: number) {
  console.log("\n🏢 Seeding departments...");
  const deptRows: Record<string, { id: number }> = {};
  for (const dept of DEPARTMENTS) {
    const row = await upsertDepartment(dept);
    deptRows[dept.departmentCode] = row;
  }

  console.log("\n👔 Seeding AI CEO...");
  const ceo = await upsertEmployee({
    employeeCode: "AI-CEO",
    employeeName: "AI CEO",
    position: "Chief Executive Officer",
    role: "director",
    level: "director",
    departmentId: null,
    providerId: defaultProviderId,
    modelId: defaultModelId,
    maxParallelJobs: 50,
    priority: 100,
  });
  await ensureCapacityAndPerformance(ceo.id);

  console.log("\n🧑‍💼 Seeding department managers...");
  for (const mgr of MANAGERS) {
    const dept = deptRows[mgr.dept];
    const employee = await upsertEmployee({
      employeeCode: mgr.code,
      employeeName: mgr.name,
      position: mgr.position,
      role: "manager",
      level: "lead",
      departmentId: dept.id,
      providerId: defaultProviderId,
      modelId: defaultModelId,
      maxParallelJobs: 10,
      priority: 80,
    });
    await ensureCapacityAndPerformance(employee.id);

    // Link department → manager
    await db
      .update(aiDepartmentsTable)
      .set({ managerAgentId: employee.id })
      .where(eq(aiDepartmentsTable.id, dept.id));
  }

  // Example decision log — CEO routing decision
  const [existingLog] = await db.select().from(aiDecisionLogsTable).limit(1);
  if (!existingLog) {
    await db.insert(aiDecisionLogsTable).values({
      decisionBy: "ai_ceo",
      decisionType: "department_selection",
      reason: "Initial workforce seed — example CEO routing decision for a creative brief request",
      selectedDepartment: "CREATIVE",
      selectedEmployee: "Creative Director",
      score: "92.00",
    });
    console.log("  ✓ Seeded example decision log");
  }

  console.log("\n✅ Workforce seed complete!");
}

// ─── Job Engine Seed ──────────────────────────────────────────────────────────

async function seedJobEngine() {
  console.log("\n🔧 Seeding Job Engine (Phase 5)...");

  // 1. Workers
  const workerDefs = [
    { workerName: "worker-alpha",   version: "1.0.0", status: "idle"    },
    { workerName: "worker-beta",    version: "1.0.0", status: "idle"    },
    { workerName: "worker-gamma",   version: "1.0.0", status: "offline" },
  ];

  const workers: Record<string, { id: number }> = {};
  for (const w of workerDefs) {
    const [existing] = await db
      .select()
      .from(aiWorkersTable)
      .where(eq(aiWorkersTable.workerName, w.workerName));

    if (existing) {
      console.log(`  ↩ Worker already exists: ${w.workerName}`);
      workers[w.workerName] = existing;
    } else {
      const [row] = await db.insert(aiWorkersTable).values(w).returning();
      console.log(`  ✓ Seeded worker: ${w.workerName}`);
      workers[w.workerName] = row!;
    }
  }

  // 2. Sample jobs — idempotent via unique jobCode check
  const sampleJobs = [
    {
      jobCode:       "JOB-SEED0001",
      jobType:       "creative_brief",
      status:        "queued",
      priority:      80,
      payloadJson:   { brief: "Q4 product launch campaign strategy", clientId: "c-001" },
      estimatedCost: 0.05,
      estimatedDuration: 30000,
    },
    {
      jobCode:       "JOB-SEED0002",
      jobType:       "llm_inference",
      status:        "queued",
      priority:      60,
      payloadJson:   { prompt: "Write a product description for NebulaPhone X", model: "gpt-4o" },
      estimatedCost: 0.02,
      estimatedDuration: 5000,
    },
    {
      jobCode:       "JOB-SEED0003",
      jobType:       "image_generation",
      status:        "running",
      priority:      70,
      payloadJson:   { prompt: "Cinematic product photo of a smartphone on a dark surface", width: 1024, height: 1024 },
      estimatedCost: 0.03,
      startedAt:     new Date(Date.now() - 15_000),
    },
    {
      jobCode:       "JOB-SEED0004",
      jobType:       "qc_review",
      status:        "retrying",
      priority:      50,
      payloadJson:   { assetId: "asset-42", checkType: "brand_alignment" },
      retryCount:    1,
      maxRetry:      3,
      errorMessage:  "QC provider timeout after 30s",
      nextRetryAt:   new Date(Date.now() + 60_000),
    },
    {
      jobCode:       "JOB-SEED0005",
      jobType:       "llm_inference",
      status:        "completed",
      priority:      40,
      payloadJson:   { prompt: "Summarise market research for Q3", model: "gpt-4o-mini" },
      resultJson:    { summary: "Market shows 18% YoY growth in the mid-range segment…" },
      actualCost:    0.008,
      actualDuration: 3200,
      startedAt:     new Date(Date.now() - 120_000),
      completedAt:   new Date(Date.now() - 116_800),
    },
    {
      jobCode:       "JOB-SEED0006",
      jobType:       "creative_brief",
      status:        "failed",
      priority:      75,
      payloadJson:   { brief: "Holiday season email sequence — 6 variations" },
      retryCount:    3,
      maxRetry:      3,
      errorMessage:  "Max retries exhausted — provider returned 503 on all attempts",
    },
    {
      jobCode:       "JOB-SEED0007",
      jobType:       "noop",
      status:        "waiting",
      priority:      30,
      payloadJson:   { reason: "Waiting for creative director approval" },
    },
  ] as const;

  const now = new Date();
  for (const job of sampleJobs) {
    const [existing] = await db
      .select()
      .from(aiJobsTable)
      .where(eq(aiJobsTable.jobCode, job.jobCode));

    if (existing) {
      console.log(`  ↩ Job already exists: ${job.jobCode}`);
      continue;
    }

    const score = computePriorityScore({
      basePriority: job.priority,
      createdAt:    now,
      retryCount:   ("retryCount" in job ? job.retryCount : 0) as number,
    });

    await db.insert(aiJobsTable).values({
      jobCode:           job.jobCode,
      jobType:           job.jobType,
      status:            job.status,
      priority:          job.priority,
      priorityScore:     String(score),
      payloadJson:       job.payloadJson as Record<string, unknown>,
      resultJson:        ("resultJson" in job ? job.resultJson : null) as Record<string, unknown> | null,
      estimatedCost:     ("estimatedCost" in job ? String(job.estimatedCost) : null),
      actualCost:        ("actualCost" in job ? String(job.actualCost) : null),
      estimatedDuration: ("estimatedDuration" in job ? job.estimatedDuration : null) as number | null,
      actualDuration:    ("actualDuration" in job ? job.actualDuration : null) as number | null,
      retryCount:        ("retryCount" in job ? job.retryCount : 0) as number,
      maxRetry:          ("maxRetry" in job ? job.maxRetry : 3) as number,
      retryStrategy:     "exponential",
      errorMessage:      ("errorMessage" in job ? job.errorMessage : null) as string | null,
      nextRetryAt:       ("nextRetryAt" in job ? job.nextRetryAt : null) as Date | null,
      startedAt:         ("startedAt" in job ? job.startedAt : null) as Date | null,
      completedAt:       ("completedAt" in job ? job.completedAt : null) as Date | null,
    });
    console.log(`  ✓ Seeded job: ${job.jobCode} (${job.jobType} / ${job.status})`);
  }

  console.log("\n✅ Job Engine seed complete!");
}

// ─── Phase 6: AI Scheduler sample schedules ───────────────────────────────────

async function upsertSchedule(input: Parameters<typeof createSchedule>[0]) {
  const [existing] = await db
    .select()
    .from(aiSchedulesTable)
    .where(eq(aiSchedulesTable.scheduleName, input.scheduleName));

  if (existing) {
    console.log(`  ↳ Schedule already exists: ${input.scheduleName}`);
    return existing;
  }

  const schedule = await createSchedule(input);
  console.log(`  ✓ Seeded schedule: ${schedule.scheduleName} (${schedule.triggerType} → ${schedule.targetType})`);
  return schedule;
}

async function seedSchedules() {
  console.log("\n🌱 Seeding AI Scheduler sample schedules...");

  await upsertSchedule({
    scheduleName: "daily-analytics-snapshot",
    description: "Creates a daily analytics_snapshot job at midnight UTC to capture platform usage metrics.",
    triggerType: "cron",
    cronExpression: "0 0 * * *",
    timezone: "UTC",
    targetType: "create_job",
    targetConfigJson: { jobType: "analytics_snapshot", priority: 40 },
    payloadJson: { source: "scheduler-sample" },
  });

  await upsertSchedule({
    scheduleName: "client-review-followup",
    description: "Creates a client_review_reminder job every 6 hours to follow up on pending client reviews.",
    triggerType: "interval",
    intervalSeconds: 6 * 60 * 60,
    timezone: "UTC",
    targetType: "create_job",
    targetConfigJson: { jobType: "client_review_reminder", priority: 35 },
    payloadJson: { source: "scheduler-sample" },
  });

  await upsertSchedule({
    scheduleName: "failed-job-cleanup",
    description: "Creates a failed_job_cleanup job every 30 minutes to sweep and archive terminally failed jobs.",
    triggerType: "interval",
    intervalSeconds: 30 * 60,
    timezone: "UTC",
    targetType: "create_job",
    targetConfigJson: { jobType: "failed_job_cleanup", priority: 20 },
    payloadJson: { source: "scheduler-sample" },
  });

  await upsertSchedule({
    scheduleName: "weekly-performance-report",
    description: "Creates a workforce_performance_report job every Monday at 06:00 UTC.",
    triggerType: "cron",
    cronExpression: "0 6 * * 1",
    timezone: "UTC",
    targetType: "create_job",
    targetConfigJson: { jobType: "workforce_performance_report", priority: 30 },
    payloadJson: { source: "scheduler-sample" },
  });

  console.log("✅ Scheduler seed complete!");
}

// ─── Phase 8: AI Skills Marketplace & Tool Ecosystem ───────────────────────────

async function upsertSkillPackage(data: typeof aiSkillPackagesTable.$inferInsert) {
  const [existing] = await db.select().from(aiSkillPackagesTable).where(eq(aiSkillPackagesTable.skillCode, data.skillCode));
  if (existing) {
    console.log(`  ↩ Skill package already exists: ${data.skillName}`);
    return existing;
  }
  const [row] = await db.insert(aiSkillPackagesTable).values(data).returning();
  console.log(`  ✓ Seeded skill package: ${data.skillName}`);
  return row!;
}

async function upsertToolPackage(data: typeof aiToolPackagesTable.$inferInsert) {
  const [existing] = await db.select().from(aiToolPackagesTable).where(eq(aiToolPackagesTable.toolCode, data.toolCode));
  if (existing) {
    console.log(`  ↩ Tool package already exists: ${data.toolName}`);
    return existing;
  }
  const [row] = await db.insert(aiToolPackagesTable).values(data).returning();
  console.log(`  ✓ Seeded tool package: ${data.toolName}`);
  return row!;
}

async function seedMarketplace() {
  console.log("\n🛒 Seeding AI Skills Marketplace & Tool Ecosystem (Phase 8)...");

  const tools = await Promise.all([
    upsertToolPackage({ toolCode: "openai", toolName: "OpenAI", provider: "OpenAI", category: "ai_model", apiType: "rest", authenticationType: "api_key", status: "published", healthStatus: "healthy", capabilities: ["llm_inference", "embeddings", "image_generation"] }),
    upsertToolPackage({ toolCode: "anthropic", toolName: "Anthropic", provider: "Anthropic", category: "ai_model", apiType: "rest", authenticationType: "api_key", status: "published", healthStatus: "healthy", capabilities: ["llm_inference"] }),
    upsertToolPackage({ toolCode: "gemini", toolName: "Gemini", provider: "Google", category: "ai_model", apiType: "rest", authenticationType: "api_key", status: "published", healthStatus: "healthy", capabilities: ["llm_inference", "multimodal"] }),
    upsertToolPackage({ toolCode: "replicate", toolName: "Replicate", provider: "Replicate", category: "ai_model", apiType: "rest", authenticationType: "api_key", status: "published", healthStatus: "healthy", capabilities: ["image_generation"] }),
    upsertToolPackage({ toolCode: "supabase", toolName: "Supabase", provider: "Supabase", category: "database", apiType: "rest", authenticationType: "api_key", status: "published", healthStatus: "unknown", capabilities: ["database", "storage", "auth"] }),
    upsertToolPackage({ toolCode: "smtp", toolName: "SMTP", provider: "Generic", category: "communication", apiType: "smtp", authenticationType: "basic", status: "published", healthStatus: "unknown", capabilities: ["email"] }),
    upsertToolPackage({ toolCode: "whatsapp", toolName: "WhatsApp", provider: "Meta", category: "communication", apiType: "rest", authenticationType: "oauth2", status: "published", healthStatus: "unknown", capabilities: ["messaging"] }),
    upsertToolPackage({ toolCode: "storage", toolName: "Storage (S3-compatible)", provider: "Generic", category: "storage", apiType: "rest", authenticationType: "api_key", status: "published", healthStatus: "healthy", capabilities: ["object_storage"] }),
    upsertToolPackage({ toolCode: "pdf", toolName: "PDF", provider: "Generic", category: "analytics", apiType: "sdk", authenticationType: "none", status: "published", healthStatus: "healthy", capabilities: ["pdf_generation", "pdf_parsing"] }),
    upsertToolPackage({ toolCode: "github", toolName: "GitHub", provider: "GitHub", category: "devops", apiType: "rest", authenticationType: "oauth2", status: "published", healthStatus: "unknown", capabilities: ["source_control", "issues"] }),
  ]);
  const toolByCode = Object.fromEntries(tools.map((t) => [t.toolCode, t]));

  const skills = await Promise.all([
    upsertSkillPackage({ skillCode: "brand-strategy", skillName: "Brand Strategy", category: "creative", description: "Develops brand positioning, voice, and messaging strategy.", status: "published", requiredTools: ["openai"], requiredCapabilities: [] }),
    upsertSkillPackage({ skillCode: "copywriting", skillName: "Copywriting", category: "creative", description: "Generates marketing and product copy.", status: "published", requiredTools: ["openai"], requiredCapabilities: ["brand-strategy"] }),
    upsertSkillPackage({ skillCode: "creative-review", skillName: "Creative Review", category: "creative", description: "QC review of creative assets against brief.", status: "published", requiredTools: ["openai"], requiredCapabilities: [] }),
    upsertSkillPackage({ skillCode: "financial-analysis", skillName: "Financial Analysis", category: "finance", description: "Analyzes financial statements and produces insights.", status: "published", requiredTools: ["openai"], requiredCapabilities: [] }),
    upsertSkillPackage({ skillCode: "ocr-invoice", skillName: "OCR Invoice", category: "finance", description: "Extracts structured data from invoice images/PDFs.", status: "published", requiredTools: ["openai", "pdf"], requiredCapabilities: [] }),
    upsertSkillPackage({ skillCode: "tax-review", skillName: "Tax Review", category: "tax", description: "Reviews tax filings for accuracy and compliance risk.", status: "published", requiredTools: ["openai"], requiredCapabilities: ["financial-analysis"] }),
    upsertSkillPackage({ skillCode: "hs-code", skillName: "HS Code Classification", category: "logistics", description: "Classifies goods under Harmonized System codes for customs.", status: "published", requiredTools: ["openai"], requiredCapabilities: [] }),
    upsertSkillPackage({ skillCode: "legal-draft", skillName: "Legal Draft", category: "legal", description: "Drafts and reviews contracts and legal documents.", status: "published", requiredTools: ["openai"], requiredCapabilities: [] }),
    upsertSkillPackage({ skillCode: "forecast", skillName: "Forecast", category: "finance", description: "Time-series forecasting for revenue, demand, and costs.", status: "published", requiredTools: ["openai"], requiredCapabilities: ["financial-analysis"] }),
    upsertSkillPackage({ skillCode: "image-generation", skillName: "Image Generation", category: "creative", description: "Generates on-brand creative imagery from prompts.", status: "published", requiredTools: ["replicate", "storage"], requiredCapabilities: ["brand-strategy"] }),
  ]);

  // Install a representative starter set for the "default" tenant so the
  // marketplace dashboard has non-zero data out of the box.
  async function upsertInstalled(packageType: "skill" | "tool", packageId: number, version: string) {
    const [existing] = await db
      .select()
      .from(aiInstalledPackagesTable)
      .where(and(eq(aiInstalledPackagesTable.tenantId, "default"), eq(aiInstalledPackagesTable.packageType, packageType), eq(aiInstalledPackagesTable.packageId, packageId)));
    if (existing) return existing;
    const [row] = await db.insert(aiInstalledPackagesTable).values({ tenantId: "default", packageType, packageId, installedVersion: version, enabled: true }).returning();
    return row!;
  }

  await upsertInstalled("tool", toolByCode.openai!.id, toolByCode.openai!.version);
  await upsertInstalled("tool", toolByCode.replicate!.id, toolByCode.replicate!.version);
  await upsertInstalled("tool", toolByCode.storage!.id, toolByCode.storage!.version);
  const brandStrategy = skills.find((s) => s.skillCode === "brand-strategy")!;
  const copywriting = skills.find((s) => s.skillCode === "copywriting")!;
  await upsertInstalled("skill", brandStrategy.id, brandStrategy.version);
  await upsertInstalled("skill", copywriting.id, copywriting.version);

  console.log("✅ Marketplace seed complete!");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Starting seed...");

  const providers = await seedProviders();
  await seedModels(providers);
  await seedWorkflows();

  // Phase 5: Image Designer agents
  // Find GPT-4o (default text model) and FLUX.1 Schnell (default image model)
  const [gpt4o] = await db
    .select()
    .from(aiModelsTable)
    .where(and(eq(aiModelsTable.modelId, "gpt-4o"), eq(aiModelsTable.providerId, providers.openai.id)));

  if (!gpt4o) {
    throw new Error("GPT-4o model not found after seedModels — cannot continue seed");
  }

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

  // Phase 4.9: AI Operating Core — Digital Workforce
  await seedWorkforce(providers.openai.id, gpt4o.id);

  // Phase 5: Job Engine
  await seedJobEngine();

  // Phase 6: AI Scheduler
  await seedSchedules();

  // Phase 8: AI Skills Marketplace & Tool Ecosystem
  await seedMarketplace();

  // AI Service Catalog & Pricing Center
  await seedServiceCatalog();

  // Service Showcase: Portfolio / Reviews / FAQ (pre-purchase creative showcase)
  await seedPortfolioShowcase();

  console.log("\n✅ Seed complete!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
