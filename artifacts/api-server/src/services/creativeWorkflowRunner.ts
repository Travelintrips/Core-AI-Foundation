/**
 * creativeWorkflowRunner — executes the 4-agent Creative Brief workflow.
 *
 * Phase 4 upgrades:
 *   - resolveAgentContext()   → injects memory tiers into each agent step
 *   - routeForAgent()         → multi-factor intelligent model selection
 *   - recordCost()            → per-step cost tracking in ai_cost_records
 *   - formatContextForPrompt() → appends memory context to system prompt
 *
 * Runs in the background (fire-and-forget after HTTP response).
 * Each step result is persisted to DB as it completes.
 * Step failures are recorded but do NOT abort the workflow.
 */

import { eq } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  aiAgentsTable,
} from "@workspace/db";
import { executeAI } from "./aiExecutionService.js";
import { getProviderApiKey } from "./aiSecretService.js";
import { logAudit } from "./aiAuditService.js";
import {
  buildBrandStrategistPrompt,
  buildCreativeDirectorPrompt,
  buildCopywriterPrompt,
  buildQcPrompt,
  parseJsonResponse,
  type CreativeBriefInput,
} from "./creativeAiService.js";
import { resolveAgentContext, formatContextForPrompt, type StepMetadata } from "./memoryResolver.js";
import { routeForAgent } from "./intelligentRouter.js";
import { recordCost } from "./costService.js";

type StepOutput = Record<string, unknown>;

interface AgentStep {
  slug: string;
  label: string;
}

const PIPELINE: AgentStep[] = [
  { slug: "brand-strategist",  label: "Brand Strategy" },
  { slug: "creative-director", label: "Creative Direction" },
  { slug: "copywriter",        label: "Copy Production" },
  { slug: "quality-control",   label: "Quality Control" },
];

/** Build the user+system prompt for a step based on its position in the pipeline. */
function buildPromptForStep(
  slug: string,
  brief: CreativeBriefInput,
  outputs: Record<string, StepOutput>,
): { systemPrompt: string; userPrompt: string } {
  const bs = outputs["brand-strategist"] ?? {};
  const cd = outputs["creative-director"] ?? {};
  const cw = outputs["copywriter"] ?? {};

  switch (slug) {
    case "brand-strategist":
      return buildBrandStrategistPrompt(brief);
    case "creative-director":
      return buildCreativeDirectorPrompt(brief, bs);
    case "copywriter":
      return buildCopywriterPrompt(brief, bs, cd);
    case "quality-control":
      return buildQcPrompt(brief, bs, cd, cw);
    default:
      throw new Error(`Unknown agent slug: ${slug}`);
  }
}

export async function runCreativeBriefWorkflow(projectDbId: number): Promise<void> {
  // Load project
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));

  if (!project) throw new Error(`Project ${projectDbId} not found`);

  const brief: CreativeBriefInput = {
    brandName: project.brandName,
    businessType: project.businessType,
    targetMarket: project.targetMarket,
    productOrService: project.productOrService,
    stylePreference: project.stylePreference,
    goal: project.goal,
    notes: project.notes,
  };

  // Mark project as running
  await db
    .update(creativeProjectsTable)
    .set({ status: "running" })
    .where(eq(creativeProjectsTable.id, projectDbId));

  const stepOutputs: Record<string, StepOutput> = {};
  const completedStepNames: string[] = [];
  const previousMetadata: StepMetadata[] = [];
  let anyFailed = false;

  for (let stepIndex = 0; stepIndex < PIPELINE.length; stepIndex++) {
    const step = PIPELINE[stepIndex];

    // Load agent from DB
    const [agent] = await db
      .select()
      .from(aiAgentsTable)
      .where(eq(aiAgentsTable.slug, step.slug));

    // ── Resolve execution context (Phase 4: memory + state) ──────────────────
    const executionContext = await resolveAgentContext({
      agentSlug: step.slug,
      stepIndex,
      totalSteps: PIPELINE.length,
      completedSteps: completedStepNames,
      currentStep: step.label,
      projectId: project.projectId,
      clientId: project.brandName,
      previousAgentOutput: stepOutputs as Record<string, Record<string, unknown>>,
      previousMetadata,
    });

    // Create step record
    const [stepRecord] = await db
      .insert(creativeProjectStepsTable)
      .values({
        projectId: projectDbId,
        agentId: agent?.id ?? null,
        stepName: step.label,
        input: {
          ...brief,
          _executionContext: {
            stepIndex,
            totalSteps: PIPELINE.length,
            clientMemoryKeys: Object.keys(executionContext.clientMemory),
            projectMemoryCount: executionContext.projectMemory.length,
          },
        } as unknown as Record<string, unknown>,
        status: "running",
      })
      .returning();

    try {
      // ── Intelligent model routing (Phase 4: multi-factor scoring) ──────────
      const routing = await routeForAgent(step.slug, {
        prompt: step.label,
        requiredContextTokens: 2000,
      });

      // If intelligent router found nothing, fall back to agent's configured model
      let selectedModel = routing?.selected ?? null;

      if (!selectedModel && agent?.modelId) {
        const { getActiveModel } = await import("./aiModelService.js");
        selectedModel = await getActiveModel(parseInt(String(agent.modelId), 10));
      }

      if (!selectedModel) {
        throw new Error(
          `No active model with a configured API key available for step '${step.label}'`,
        );
      }

      // ── Build prompt with memory context injected ─────────────────────────
      const { systemPrompt: baseSystemPrompt, userPrompt } = buildPromptForStep(
        step.slug,
        brief,
        stepOutputs,
      );

      // Append memory context to system prompt
      const memoryContext = formatContextForPrompt(executionContext);
      const systemPrompt = baseSystemPrompt + memoryContext;

      const temperature = agent?.temperature ? parseFloat(agent.temperature) : 0.7;
      const maxTokens = agent?.maxTokens ?? 4096;

      // ── Execute AI ────────────────────────────────────────────────────────
      const result = await executeAI({
        prompt: userPrompt,
        systemPrompt,
        model: selectedModel.model,
        provider: selectedModel.provider,
        temperature,
        maxTokens,
      });

      // ── Record cost (Phase 4: cost intelligence) ──────────────────────────
      await recordCost({
        projectId: project.projectId,
        stepId: stepRecord.id,
        clientId: project.brandName,
        agentSlug: step.slug,
        provider: selectedModel.provider.slug,
        model: selectedModel.model.modelId,
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        latencyMs: result.latencyMs,
        retryCount: 0,
        fallbackCount: routing?.usedCapabilityMatrix ? 0 : 0,
        status: "success",
        modelRecord: selectedModel.model,
      }).catch((err) => {
        console.warn("[creative-ai] Cost recording failed (non-blocking):", err);
      });

      // Parse JSON output
      let parsedOutput: StepOutput;
      try {
        parsedOutput = parseJsonResponse(result.content);
      } catch {
        parsedOutput = { raw: result.content };
      }

      stepOutputs[step.slug] = parsedOutput;
      completedStepNames.push(step.label);
      previousMetadata.push({
        stepName: step.label,
        model: selectedModel.model.modelId,
        provider: selectedModel.provider.slug,
        tokens: result.tokensUsed,
        latencyMs: result.latencyMs,
      });

      // Update step as completed
      await db
        .update(creativeProjectStepsTable)
        .set({
          output: parsedOutput,
          provider: selectedModel.provider.slug,
          model: selectedModel.model.modelId,
          tokenUsage: result.tokensUsed,
          latencyMs: result.latencyMs,
          status: "completed",
        })
        .where(eq(creativeProjectStepsTable.id, stepRecord.id));

      await logAudit(
        "creative-ai",
        `step_completed:${step.slug}`,
        String(projectDbId),
        "creative_project",
        "success",
        {
          step: step.label,
          model: selectedModel.model.modelId,
          tokensUsed: result.tokensUsed,
          latencyMs: result.latencyMs,
          usedCapabilityMatrix: routing?.usedCapabilityMatrix ?? false,
        },
      );
    } catch (err) {
      anyFailed = true;
      const errorMessage = String(err);

      // Record failed cost entry
      await recordCost({
        projectId: project.projectId,
        stepId: stepRecord.id,
        clientId: project.brandName,
        agentSlug: step.slug,
        provider: "unknown",
        model: "unknown",
        inputTokens: 0,
        outputTokens: 0,
        status: "failed",
      }).catch(() => {});

      await db
        .update(creativeProjectStepsTable)
        .set({ status: "failed", errorMessage })
        .where(eq(creativeProjectStepsTable.id, stepRecord.id));

      await logAudit(
        "creative-ai",
        `step_failed:${step.slug}`,
        String(projectDbId),
        "creative_project",
        "failure",
        { step: step.label, error: errorMessage },
      );

      // Record empty output so downstream agents still run
      stepOutputs[step.slug] = {};
    }
  }

  // Aggregate all outputs into project.result
  const aggregatedResult = {
    brandStrategy:    stepOutputs["brand-strategist"] ?? null,
    creativeDirection: stepOutputs["creative-director"] ?? null,
    copy:             stepOutputs["copywriter"] ?? null,
    qcReview:         stepOutputs["quality-control"] ?? null,
  };

  // Reflect true outcome — if any step failed, mark the project as failed
  const finalStatus = anyFailed ? "failed" : "completed";

  await db
    .update(creativeProjectsTable)
    .set({ status: finalStatus, result: aggregatedResult })
    .where(eq(creativeProjectsTable.id, projectDbId));

  await logAudit(
    "creative-ai",
    "workflow_completed",
    String(projectDbId),
    "creative_project",
    anyFailed ? "failure" : "success",
    {
      projectId: project.projectId,
      stepsCompleted: Object.keys(stepOutputs).length,
      anyFailed,
    },
  );
}
