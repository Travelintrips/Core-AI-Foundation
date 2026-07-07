/**
 * test-runs.ts — Synthetic test runner for populating analytics data.
 *
 * POST /ai/test-runs/creative
 *   Creates 5 sample Creative AI projects with synthetic agent outputs
 *   and realistic cost records so analytics + agent stats are populated.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  aiCostRecordsTable,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

// ── Synthetic project definitions ─────────────────────────────────────────────

interface SyntheticProject {
  brandName: string;
  businessType: string;
  targetMarket: string;
  productOrService: string;
  stylePreference: string;
  goal: string;
  notes: string;
  provider: string;
  model: string;
  daysAgo: number;
}

const SYNTHETIC_PROJECTS: SyntheticProject[] = [
  {
    brandName: "Kopi Luwak Premium",
    businessType: "Specialty Coffee Roaster",
    targetMarket: "Urban professionals 25-40",
    productOrService: "Single-origin premium coffee beans and brewing accessories",
    stylePreference: "Minimalist, earthy, premium",
    goal: "Launch brand awareness campaign for Jakarta premium market",
    notes: "Focus on farm-to-cup transparency and artisanal craftsmanship",
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    daysAgo: 6,
  },
  {
    brandName: "Glow Natural",
    businessType: "Local Skincare Brand",
    targetMarket: "Women 20-35, eco-conscious consumers",
    productOrService: "Natural and organic skincare products with local botanicals",
    stylePreference: "Soft, clean, botanical",
    goal: "Build digital brand identity for e-commerce launch",
    notes: "Emphasize local ingredients, cruelty-free, sustainable packaging",
    provider: "openai",
    model: "gpt-4o",
    daysAgo: 5,
  },
  {
    brandName: "LogiStar",
    businessType: "Logistics and Supply Chain",
    targetMarket: "SME businesses across Southeast Asia",
    productOrService: "End-to-end logistics solutions and freight forwarding",
    stylePreference: "Professional, trustworthy, modern",
    goal: "Corporate rebranding and new company profile content",
    notes: "Highlight reliability, regional network, and tech-enabled tracking",
    provider: "google-gemini",
    model: "gemini-1.5-pro-latest",
    daysAgo: 3,
  },
  {
    brandName: "FitZone",
    businessType: "Sport Center and Fitness Studio",
    targetMarket: "Active adults 18-45 in urban areas",
    productOrService: "Gym memberships, personal training, group fitness classes",
    stylePreference: "Energetic, bold, motivational",
    goal: "Social media campaign to drive January membership sign-ups",
    notes: "Include transformation stories, class highlights, and trainer spotlights",
    provider: "anthropic",
    model: "claude-3-haiku-20240307",
    daysAgo: 2,
  },
  {
    brandName: "TradeGlobal",
    businessType: "Export-Import Trading",
    targetMarket: "International buyers and local exporters",
    productOrService: "Agricultural commodities and consumer goods trading",
    stylePreference: "Corporate, international, reliable",
    goal: "Build B2B brand presence and attract international buyer partnerships",
    notes: "Multilingual approach, emphasize compliance and trade expertise",
    provider: "openai",
    model: "gpt-4o-mini",
    daysAgo: 0,
  },
];

// ── Synthetic step outputs ────────────────────────────────────────────────────

function makeBrandStrategyOutput(p: SyntheticProject) {
  return {
    brand_values: ["Authenticity", "Quality", "Innovation"],
    positioning: `${p.brandName} is the premium choice for ${p.targetMarket}.`,
    target_audience: p.targetMarket,
    competitive_advantage: `Superior quality combined with deep ${p.businessType} expertise`,
    brand_personality: p.stylePreference,
    key_messages: [
      `${p.brandName}: Where quality meets purpose`,
      `Trusted by ${p.targetMarket}`,
    ],
  };
}

function makeCreativeDirectionOutput(p: SyntheticProject) {
  return {
    visual_identity: `${p.stylePreference} aesthetic with modern design sensibilities`,
    color_palette: ["#1A1A2E", "#E94560", "#F5F5F5"],
    typography: "Bold geometric sans-serif for headlines, clean body text for readability",
    imagery_style: "High-contrast product photography with lifestyle context",
    overall_direction: `Premium, cohesive brand identity for ${p.targetMarket}`,
  };
}

function makeCopyOutput(p: SyntheticProject) {
  return {
    tagline: `${p.brandName} — Beyond Ordinary`,
    headline: `Experience the ${p.businessType} Difference`,
    body_copy: `${p.brandName} brings you the finest ${p.productOrService}. Crafted with precision for ${p.targetMarket}.`,
    cta: "Discover More",
    social_captions: [
      `Quality you trust, experience you love. #${p.brandName.replace(/[^a-z0-9]/gi, "")}`,
      `Join thousands of satisfied customers.`,
    ],
  };
}

function makeQcOutput() {
  const score = Math.floor(82 + Math.random() * 13);
  return {
    overall_score: score,
    brand_consistency: "Strong",
    messaging_clarity: "Clear and compelling",
    target_audience_alignment: "Excellent fit",
    recommendations: ["Strengthen local market references", "Add more specific value props"],
    approved: true,
  };
}

// ── Step metadata ─────────────────────────────────────────────────────────────

const STEP_META = [
  { stepName: "Brand Strategy",    agentSlug: "brand-strategist",  inputTokens: 820,  outputTokens: 580,  latencyMs: 2400 },
  { stepName: "Creative Direction", agentSlug: "creative-director", inputTokens: 1180, outputTokens: 760,  latencyMs: 3100 },
  { stepName: "Copy Production",   agentSlug: "copywriter",        inputTokens: 1540, outputTokens: 980,  latencyMs: 4200 },
  { stepName: "Quality Control",   agentSlug: "quality-control",   inputTokens: 1890, outputTokens: 1140, latencyMs: 3600 },
];

const OUTPUT_FNS = [makeBrandStrategyOutput, makeCreativeDirectionOutput, makeCopyOutput, () => makeQcOutput()];
const COST_PER_INPUT = 0.0000025;
const COST_PER_OUTPUT = 0.00001;

// ── Main handler ──────────────────────────────────────────────────────────────

router.post("/ai/test-runs/creative", async (_req, res): Promise<void> => {
  const created: string[] = [];
  const errors: string[] = [];

  // ── Idempotency: remove existing synthetic projects before re-seeding ──────
  const syntheticNames = SYNTHETIC_PROJECTS.map((p) => p.brandName);
  const existingProjects = await db
    .select({ id: creativeProjectsTable.id, projectId: creativeProjectsTable.projectId })
    .from(creativeProjectsTable)
    .where(inArray(creativeProjectsTable.brandName, syntheticNames));

  if (existingProjects.length > 0) {
    const dbIds = existingProjects.map((p) => p.id);
    const projectUuids = existingProjects.map((p) => p.projectId).filter(Boolean) as string[];

    // Delete in dependency order: cost records → steps → projects
    if (projectUuids.length > 0) {
      await db
        .delete(aiCostRecordsTable)
        .where(inArray(aiCostRecordsTable.projectId, projectUuids));
    }
    await db
      .delete(creativeProjectStepsTable)
      .where(inArray(creativeProjectStepsTable.projectId, dbIds));
    await db
      .delete(creativeProjectsTable)
      .where(inArray(creativeProjectsTable.id, dbIds));
  }

  for (const sp of SYNTHETIC_PROJECTS) {
    try {
      const projectId = randomUUID();
      const createdAt = new Date(Date.now() - sp.daysAgo * 24 * 60 * 60 * 1000);

      const aggregatedResult = {
        brandStrategy:     makeBrandStrategyOutput(sp),
        creativeDirection: makeCreativeDirectionOutput(sp),
        copy:              makeCopyOutput(sp),
        qcReview:          makeQcOutput(),
      };

      // Insert project — use type assertion to allow passing createdAt
      const [project] = await db
        .insert(creativeProjectsTable)
        .values({
          projectId,
          brandName: sp.brandName,
          businessType: sp.businessType,
          targetMarket: sp.targetMarket,
          productOrService: sp.productOrService,
          stylePreference: sp.stylePreference,
          goal: sp.goal,
          notes: sp.notes,
          status: "completed",
          result: aggregatedResult,
          createdAt,
        } as unknown as typeof creativeProjectsTable.$inferInsert)
        .returning({ id: creativeProjectsTable.id });

      for (let i = 0; i < STEP_META.length; i++) {
        const sm = STEP_META[i];
        const stepOffset = i * 70_000;
        const stepCreatedAt = new Date(createdAt.getTime() + stepOffset);
        const output = OUTPUT_FNS[i](sp);
        const estimatedCost = sm.inputTokens * COST_PER_INPUT + sm.outputTokens * COST_PER_OUTPUT;
        const totalTokens = sm.inputTokens + sm.outputTokens;

        const [step] = await db
          .insert(creativeProjectStepsTable)
          .values({
            projectId: project.id,
            agentId: null,
            stepName: sm.stepName,
            input: {} as Record<string, unknown>,
            output: output as Record<string, unknown>,
            provider: sp.provider,
            model: sp.model,
            tokenUsage: totalTokens,
            latencyMs: sm.latencyMs,
            status: "completed",
            createdAt: stepCreatedAt,
          } as unknown as typeof creativeProjectStepsTable.$inferInsert)
          .returning({ id: creativeProjectStepsTable.id });

        await db
          .insert(aiCostRecordsTable)
          .values({
            projectId,
            stepId: step.id,
            clientId: sp.brandName,
            agentSlug: sm.agentSlug,
            provider: sp.provider,
            model: sp.model,
            inputTokens: sm.inputTokens,
            outputTokens: sm.outputTokens,
            totalTokens,
            estimatedCostUsd: estimatedCost.toFixed(8),
            latencyMs: sm.latencyMs,
            retryCount: 0,
            fallbackCount: 0,
            status: "success",
            createdAt: stepCreatedAt,
          } as unknown as typeof aiCostRecordsTable.$inferInsert);
      }

      created.push(sp.brandName);
    } catch (err) {
      errors.push(`${sp.brandName}: ${String(err)}`);
    }
  }

  await logAudit("test-runs", "create_synthetic", "system", "creative_project", "success", {
    created: created.length,
    errors: errors.length,
  });

  res.json({
    ok: errors.length === 0,
    created,
    errors,
    message: `Created ${created.length} synthetic projects. Analytics data is now populated.`,
  });
});

export default router;
