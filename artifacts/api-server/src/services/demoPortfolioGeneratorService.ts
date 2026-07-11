/**
 * demoPortfolioGeneratorService — AI-powered demo portfolio batch generation.
 *
 * Uses the existing AI OS (Brand Strategist via intelligentRouter + executeAI,
 * event bus, audit log) to produce fictional, safety-checked demo portfolios.
 *
 * ALL demo portfolios:
 *   - use fictional brand names (not real companies)
 *   - are labeled "AI Demo Project"
 *   - carry trademark_risk scoring (high risk → cannot auto-publish)
 *   - require manual admin approval by default (autoPublish = false)
 *   - are subject to a max_cost budget guardrail per batch
 *
 * Does NOT create a new AI pipeline — reuses routeForAgent, executeAI,
 * aiEventBusService, aiAuditService, creativeAiService.
 */
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  aiPortfolioGenerationBatchesTable,
  aiServicePortfoliosTable,
  aiServicesTable,
} from "@workspace/db";
import { routeForAgent } from "./intelligentRouter.js";
import { executeAI, type ExecutionInput } from "./aiExecutionService.js";
import { parseJsonResponse } from "./creativeAiService.js";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

const WORKFLOW_STANDARD = [
  { step: "brief", label: "Brief" },
  { step: "brand-strategy", label: "Brand Strategy" },
  { step: "creative-direction", label: "Creative Direction" },
  { step: "generation", label: "AI Generation" },
  { step: "qc", label: "Quality Check" },
  { step: "delivery", label: "Final Delivery" },
];

function makeBatchCode(): string {
  return `BATCH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BatchConfig {
  serviceId?: number;
  industry: string;
  style: string;
  packageLevel?: string;
  requestedCount?: number;
  maxCost?: number;
  autoPublish?: boolean;
  qcThreshold?: number;
  createdBy?: string;
}

export async function createGenerationBatch(config: BatchConfig) {
  const [batch] = await db
    .insert(aiPortfolioGenerationBatchesTable)
    .values({
      batchCode: makeBatchCode(),
      serviceId: config.serviceId ?? null,
      industry: config.industry,
      style: config.style,
      packageLevel: config.packageLevel ?? "standard",
      requestedCount: Math.min(config.requestedCount ?? 3, 10),
      maxCost: config.maxCost != null ? String(config.maxCost) : null,
      autoPublish: config.autoPublish ?? false,
      qcThreshold: config.qcThreshold ?? 70,
      status: "draft",
      createdBy: config.createdBy ?? "admin",
    })
    .returning();

  await logAudit("portfolio-generator", "batch_created", String(batch!.id), "ai_portfolio_generation_batch", "success", { batchCode: batch!.batchCode });
  return batch!;
}

export async function startBatch(batchId: number): Promise<void> {
  const [batch] = await db
    .select()
    .from(aiPortfolioGenerationBatchesTable)
    .where(eq(aiPortfolioGenerationBatchesTable.id, batchId))
    .limit(1);

  if (!batch) throw new Error(`Batch ${batchId} not found`);
  if (!["draft", "failed", "partially_failed"].includes(batch.status)) {
    throw new Error(`Batch ${batchId} cannot be started (status: ${batch.status})`);
  }

  await db
    .update(aiPortfolioGenerationBatchesTable)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiPortfolioGenerationBatchesTable.id, batchId));

  await logAudit("portfolio-generator", "batch_started", String(batchId), "ai_portfolio_generation_batch", "success");

  // Fire-and-forget
  runBatch(batch).catch(async (err) => {
    console.error(`[portfolio-generator] Batch ${batchId} error:`, err);
    await db
      .update(aiPortfolioGenerationBatchesTable)
      .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(aiPortfolioGenerationBatchesTable.id, batchId));
  });
}

export async function cancelBatch(batchId: number): Promise<void> {
  await db
    .update(aiPortfolioGenerationBatchesTable)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(aiPortfolioGenerationBatchesTable.id, batchId),
      eq(aiPortfolioGenerationBatchesTable.status, "running"),
    ));
  await logAudit("portfolio-generator", "batch_cancelled", String(batchId), "ai_portfolio_generation_batch", "success");
}

export async function approvePortfolio(portfolioId: number, approvedBy?: string) {
  const [row] = await db
    .update(aiServicePortfoliosTable)
    .set({ publishStatus: "published", status: "published", updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .returning();

  if (!row) throw new Error(`Portfolio ${portfolioId} not found`);
  await logAudit("portfolio-generator", "portfolio_approved", String(portfolioId), "ai_service_portfolio", "success", { approvedBy });
  await publishSafe({ eventType: "portfolio_approved", sourceModule: "portfolio-generator", sourceId: String(portfolioId), payload: { approvedBy } });
  return row;
}

export async function rejectPortfolio(portfolioId: number, reason?: string) {
  const [row] = await db
    .update(aiServicePortfoliosTable)
    .set({ publishStatus: "archived", status: "hidden", updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .returning();

  if (!row) throw new Error(`Portfolio ${portfolioId} not found`);
  await logAudit("portfolio-generator", "portfolio_rejected", String(portfolioId), "ai_service_portfolio", "failure", { reason });
  return row;
}

// ── Internal batch runner ─────────────────────────────────────────────────────

async function runBatch(batch: typeof aiPortfolioGenerationBatchesTable.$inferSelect): Promise<void> {
  let actualCost = parseFloat(batch.actualCost ?? "0");
  const maxCost = batch.maxCost ? parseFloat(batch.maxCost) : Infinity;

  for (let i = 0; i < batch.requestedCount; i++) {
    // Check if cancelled externally
    const [current] = await db
      .select({ status: aiPortfolioGenerationBatchesTable.status })
      .from(aiPortfolioGenerationBatchesTable)
      .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id))
      .limit(1);
    if (current?.status === "cancelled") return;

    // Budget guardrail (use estimated cost — ExecutionOutput has no cost field)
    if (actualCost >= maxCost) {
      await db
        .update(aiPortfolioGenerationBatchesTable)
        .set({ status: "blocked_by_budget", actualCost: String(actualCost), updatedAt: new Date() })
        .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));
      await logAudit("portfolio-generator", "batch_blocked_budget", String(batch.id), "ai_portfolio_generation_batch", "failure", { actualCost, maxCost });
      return;
    }

    try {
      const estimatedCost = await generateOneDemoPortfolio({
        industry: batch.industry, style: batch.style, packageLevel: batch.packageLevel,
        serviceId: batch.serviceId ?? undefined, autoPublish: batch.autoPublish,
        qcThreshold: batch.qcThreshold, batchId: batch.id,
      });
      actualCost += estimatedCost;
      await db
        .update(aiPortfolioGenerationBatchesTable)
        .set({ generatedCount: sql`${aiPortfolioGenerationBatchesTable.generatedCount} + 1`, actualCost: String(actualCost), updatedAt: new Date() })
        .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));
    } catch {
      await db
        .update(aiPortfolioGenerationBatchesTable)
        .set({ failedCount: sql`${aiPortfolioGenerationBatchesTable.failedCount} + 1`, updatedAt: new Date() })
        .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));
    }
  }

  const [final] = await db
    .select()
    .from(aiPortfolioGenerationBatchesTable)
    .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id))
    .limit(1);

  const finalStatus = !final || final.generatedCount === 0 ? "failed"
    : final.failedCount > 0 ? "partially_failed" : "review";

  await db
    .update(aiPortfolioGenerationBatchesTable)
    .set({ status: finalStatus, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));

  await publishSafe({ eventType: "portfolio_batch_completed", sourceModule: "portfolio-generator", sourceId: String(batch.id), payload: { batchId: batch.id, status: finalStatus, actualCost } });
}

interface SingleGenConfig {
  industry: string;
  style: string;
  packageLevel: string;
  serviceId?: number;
  autoPublish: boolean;
  qcThreshold: number;
  batchId: number;
}

/** Returns an estimated cost (token-based heuristic since ExecutionOutput has no cost field). */
async function generateOneDemoPortfolio(config: SingleGenConfig): Promise<number> {
  // Route to brand_strategist
  const routing = await routeForAgent("brand_strategist", { prompt: "portfolio-demo-generation", requiredContextTokens: 900 });
  if (!routing) throw new Error("No active AI model for brand_strategist");

  const userPrompt = `Create a fictional brand concept (for demo portfolio purposes only, NOT a real company) for:
Industry: ${config.industry}
Visual style: ${config.style}
Package: ${config.packageLevel}

Rules: fictional Indonesian-sounding name, must NOT resemble any trademark.

Return ONLY JSON (no markdown):
{"brandName":"string","tagline":"string","shortDescription":"string (max 60 words)","fullDescription":"string (max 180 words)","businessType":"string","primaryColor":"#hex","secondaryColor":"#hex","trademarkRisk":"low|medium|high","qcScore":number,"deliverables":["string"],"toolsUsed":["string"]}`;

  const execInput: ExecutionInput = {
    prompt: userPrompt,
    systemPrompt: "You are a senior Brand Strategist creating fictional demo brand concepts for an AI creative agency portfolio showcase. Output strict JSON only — no markdown, no commentary.",
    model: routing.selected.model,
    provider: routing.selected.provider,
    temperature: 0.85,
    maxTokens: 800,
  };

  const result = await executeAI(execInput);
  const concept = parseJsonResponse(result.content) as Record<string, unknown>;

  // Estimate cost from token usage (heuristic: ~$0.002 per 1K tokens for GPT-4o-mini class)
  const estimatedCost = (result.tokensUsed / 1000) * 0.002;

  const brandName = String(concept["brandName"] ?? `Demo ${config.industry}`);
  const trademarkRisk = ["low", "medium", "high"].includes(String(concept["trademarkRisk"]))
    ? String(concept["trademarkRisk"]) : "medium";
  const qcScore = Math.min(100, Math.max(0, Number(concept["qcScore"] ?? 55)));
  const canAutoPublish = config.autoPublish && qcScore >= config.qcThreshold && trademarkRisk === "low";

  let serviceId = config.serviceId;
  if (!serviceId) {
    const [svc] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.status, "active")).limit(1);
    serviceId = svc?.id;
  }
  if (!serviceId) throw new Error("No active service for portfolio");

  const portfolioCode = `DEMO-${config.industry.toUpperCase().replace(/\s+/g, "-")}-${Date.now().toString(36).toUpperCase()}`;
  const slug = `${config.industry.toLowerCase()}-${brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`.substring(0, 100);

  const insertValues: Record<string, unknown> = {
    serviceId,
    title: `${brandName} — ${config.style} ${config.industry}`,
    industry: config.industry,
    style: config.style,
    shortDescription: String(concept["shortDescription"] ?? ""),
    description: String(concept["fullDescription"] ?? ""),
    businessType: String(concept["businessType"] ?? config.industry),
    primaryColor: String(concept["primaryColor"] ?? "#1A1A1A"),
    secondaryColor: String(concept["secondaryColor"] ?? "#F5F5F5"),
    packageLevel: config.packageLevel,
    portfolioCode, slug,
    isDemo: true, trademarkRisk,
    qcScore: String(qcScore),
    publishStatus: canAutoPublish ? "published" : "review",
    status: canAutoPublish ? "published" : "draft",
    featured: false,
    deliverablesJson: Array.isArray(concept["deliverables"]) ? concept["deliverables"] : [],
    toolsUsedJson: Array.isArray(concept["toolsUsed"]) ? concept["toolsUsed"] : ["Brand Strategist AI", "Creative Director AI"],
    workflowJson: WORKFLOW_STANDARD,
    metadataJson: { batchId: config.batchId, generated: new Date().toISOString(), disclaimer: "AI Demo Project — Conceptual example only. Not a real client." },
    completedProjects: 0, displayOrder: 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [portfolio] = await db.insert(aiServicePortfoliosTable).values(insertValues as any).returning();
  await publishSafe({ eventType: "portfolio_generated", sourceModule: "portfolio-generator", sourceId: String(portfolio!.id), payload: { batchId: config.batchId, qcScore } });
  return estimatedCost;
}
