/**
 * creativeWorkflowRunner — executes the 4-agent Creative Brief workflow.
 *
 * Phase 4 features (existing):
 *   - resolveAgentContext()   → injects memory tiers into each agent step
 *   - routeForAgent()         → multi-factor intelligent model selection
 *   - recordCost()            → per-step cost tracking in ai_cost_records
 *   - formatContextForPrompt() → appends memory context to system prompt
 *
 * Phase 4.5 additions:
 *   - readGuardrails()            → reads guardrail config from ai_settings
 *   - Budget check per step       → blocks step with status "blocked_by_budget"
 *   - executeWithRetryAndTimeout() → retry loop with configurable timeout
 *   - Fallback on failure         → tries fallback models when primary fails
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
import { executeAI, type ExecutionInput, type ExecutionOutput, type ObservabilityContext } from "./aiExecutionService.js";
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
import { recordCost, getProjectCosts } from "./costService.js";
import { readGuardrails } from "./guardrailService.js";
import { getActiveModel } from "./aiModelService.js";
import { createExecutionPlanForCreativeProject } from "./aiCeoService.js";
import { resolveProjectDocumentType } from "./creativeProjectDocumentType.js";
import { resolveProjectPresentationType } from "./creativeProjectPresentationType.js";
import { enqueue } from "./queueManagerService.js";

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

// ── Execution safety: retry + timeout ─────────────────────────────────────────

interface ExecResult {
  output: ExecutionOutput;
  retryCount: number;
  fallbackCount: number;
  usedModel: ExecutionInput["model"];
  usedProvider: ExecutionInput["provider"];
}

async function executeWithRetryAndTimeout(
  primaryInput: ExecutionInput,
  fallbackInputs: ExecutionInput[],
  maxRetries: number,
  timeoutMs: number,
): Promise<ExecResult> {
  const candidates: ExecutionInput[] = [primaryInput, ...fallbackInputs];
  let overallRetryCount = 0;
  let fallbackCount = 0;

  for (let candidateIdx = 0; candidateIdx < candidates.length; candidateIdx++) {
    const input = candidates[candidateIdx];
    const isFallback = candidateIdx > 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const output = await Promise.race([
          executeAI(input),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`AI request timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ]);
        if (isFallback) fallbackCount++;
        return { output, retryCount: overallRetryCount, fallbackCount, usedModel: input.model, usedProvider: input.provider };
      } catch (err) {
        overallRetryCount++;
        if (attempt < maxRetries) {
          // Exponential back-off: 1s, 2s, 4s
          await new Promise<void>((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        } else if (isFallback || candidateIdx === candidates.length - 1) {
          // Last candidate exhausted
          throw err;
        }
        // else: move to next candidate
      }
    }
  }

  throw new Error("All providers exhausted");
}

// ── Budget check ──────────────────────────────────────────────────────────────

async function checkProjectBudget(
  projectId: string,
  maxCostUsd: number,
): Promise<{ exceeded: boolean; currentCostUsd: number }> {
  if (maxCostUsd <= 0) return { exceeded: false, currentCostUsd: 0 };
  try {
    const costs = await getProjectCosts(projectId);
    return {
      exceeded: costs.totalEstimatedCostUsd >= maxCostUsd,
      currentCostUsd: costs.totalEstimatedCostUsd,
    };
  } catch {
    return { exceeded: false, currentCostUsd: 0 };
  }
}

// ── Main workflow ─────────────────────────────────────────────────────────────

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
    stylePreference: project.stylePreference ?? "",
    goal: project.goal,
    notes: project.notes,
  };

  // Phase 4.5: Read guardrails once at start
  const guardrails = await readGuardrails();

  // Mark project as running
  await db
    .update(creativeProjectsTable)
    .set({ status: "running" })
    .where(eq(creativeProjectsTable.id, projectDbId));

  // Phase 4.9: Create execution plan behind the scenes (AI Operating Core).
  // Non-blocking — never break the creative workflow if this fails.
  createExecutionPlanForCreativeProject(
    project.projectId,
    `${project.goal} — ${project.brandName} (${project.businessType})`,
  ).catch(() => {});

  const stepOutputs: Record<string, StepOutput> = {};
  const completedStepNames: string[] = [];
  const previousMetadata: StepMetadata[] = [];
  let anyFailed = false;

  for (let stepIndex = 0; stepIndex < PIPELINE.length; stepIndex++) {
    const step = PIPELINE[stepIndex];

    // ── Phase 4.5: Budget check before each step ──────────────────────────────
    const budgetCheck = await checkProjectBudget(project.projectId, guardrails.maxCostPerWorkflow);
    if (budgetCheck.exceeded) {
      const errorMessage =
        `Budget limit exceeded: $${budgetCheck.currentCostUsd.toFixed(4)} ` +
        `/ $${guardrails.maxCostPerWorkflow.toFixed(2)} max per workflow. ` +
        `Step blocked.`;

      // Create step record as blocked
      await db.insert(creativeProjectStepsTable).values({
        projectId: projectDbId,
        agentId: null,
        stepName: step.label,
        input: { _blocked: true, _reason: "budget_exceeded" } as unknown as Record<string, unknown>,
        status: "blocked_by_budget",
        errorMessage,
      });

      await logAudit(
        "creative-ai",
        `step_blocked:${step.slug}`,
        String(projectDbId),
        "creative_project",
        "failure",
        {
          step: step.label,
          reason: "budget_exceeded",
          currentCostUsd: budgetCheck.currentCostUsd,
          maxCostUsd: guardrails.maxCostPerWorkflow,
        },
      );

      anyFailed = true;
      // Continue loop — remaining steps will also be blocked
      continue;
    }

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

      // Determine primary model
      let selectedModel = routing?.selected ?? null;

      if (!selectedModel && agent?.modelId) {
        selectedModel = await getActiveModel(parseInt(String(agent.modelId), 10));
      }

      if (!selectedModel) {
        throw new Error(
          `No active model with a configured API key available for step '${step.label}'`,
        );
      }

      // Build fallback input list (Phase 4.5)
      const fallbackModels = (routing?.fallbackEnabled !== false && routing?.fallbacks)
        ? routing.fallbacks.filter((m) => !!getProviderApiKey(m.provider.slug))
        : [];

      const temperature = agent?.temperature ? parseFloat(agent.temperature) : 0.7;
      const maxTokens = agent?.maxTokens ?? 4096;

      // ── Build prompt with memory context injected ─────────────────────────
      const { systemPrompt: baseSystemPrompt, userPrompt } = buildPromptForStep(
        step.slug,
        brief,
        stepOutputs,
      );

      const memoryContext = formatContextForPrompt(executionContext);
      const systemPrompt = baseSystemPrompt + memoryContext;

      const stepObservability: ObservabilityContext = {
        agentId:      agent?.id     ?? null,
        agentName:    step.slug,
        providerName: selectedModel.provider.slug,
        modelName:    selectedModel.model.modelId,
        requestType:  "text",
      };

      const primaryInput: ExecutionInput = {
        prompt: userPrompt,
        systemPrompt,
        model: selectedModel.model,
        provider: selectedModel.provider,
        temperature,
        maxTokens,
        observability: stepObservability,
      };

      const fallbackInputs: ExecutionInput[] = fallbackModels.map((m) => ({
        prompt: userPrompt,
        systemPrompt,
        model: m.model,
        provider: m.provider,
        temperature,
        maxTokens,
        observability: { ...stepObservability, providerName: m.provider.slug, modelName: m.model.modelId },
      }));

      // ── Execute AI with retry + timeout (Phase 4.5) ───────────────────────
      const execResult = await executeWithRetryAndTimeout(
        primaryInput,
        fallbackInputs,
        guardrails.maxRetryPerProvider,
        guardrails.providerTimeoutMs,
      );
      const { output: result, retryCount, fallbackCount } = execResult;

      // ── Record cost (Phase 4: cost intelligence) ──────────────────────────
      await recordCost({
        projectId: project.projectId,
        stepId: stepRecord.id,
        clientId: project.brandName,
        agentSlug: step.slug,
        provider: String(execResult.usedProvider.slug),
        model: String(execResult.usedModel.modelId),
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        latencyMs: result.latencyMs,
        retryCount,
        fallbackCount,
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
        agentSlug: step.slug,
        status: "success",
        latencyMs: result.latencyMs,
        tokenCount: result.tokensUsed,
      });

      // Update step as completed
      await db
        .update(creativeProjectStepsTable)
        .set({
          output: parsedOutput,
          provider: String(execResult.usedProvider.slug),
          model: String(execResult.usedModel.modelId),
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
          model: String(execResult.usedModel.modelId),
          tokensUsed: result.tokensUsed,
          latencyMs: result.latencyMs,
          retryCount,
          fallbackCount,
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
    brandStrategy:     stepOutputs["brand-strategist"] ?? null,
    creativeDirection: stepOutputs["creative-director"] ?? null,
    copy:              stepOutputs["copywriter"] ?? null,
    qcReview:          stepOutputs["quality-control"] ?? null,
  };

  // Reflect true outcome. Document-producing projects (e.g. Company Profile)
  // are not truly "completed" until their PDF has rendered — hold them at
  // "generating_document" so the customer workspace never shows a finished
  // project with no deliverable yet.
  const documentType = anyFailed ? null : await resolveProjectDocumentType(project);
  const isDocumentProject = documentType !== null;
  const presentationType = anyFailed || isDocumentProject ? null : await resolveProjectPresentationType(project);
  const isPresentationProject = presentationType !== null;
  const finalStatus = anyFailed
    ? "failed"
    : isDocumentProject
      ? "generating_document"
      : isPresentationProject
        ? "generating_presentation"
        : "completed";

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

  // Kick off visual asset generation once the text pipeline has produced
  // creative direction to draw from. This pipeline is a distinct feature
  // (Image Prompt Generator → Replicate FLUX.1 → Image QC) that previously
  // had no automatic trigger anywhere in the app — it only existed as a
  // manual POST endpoint nothing in the UI ever called, so the "Visual
  // Assets" section on the review page stayed empty forever. Run it
  // fire-and-forget so a slow/failed image pipeline never blocks the
  // text-generation status update above.
  if (!anyFailed) {
    const { runImageDesignerPipeline } = await import("./imageDesignerService.js");
    const imagesDone = runImageDesignerPipeline(projectDbId, project.projectId, 2).catch(async (err) => {
      console.error(`[image-designer] Pipeline failed for project ${project.projectId}:`, err);
      await logAudit(
        "creative-ai",
        "image_pipeline_error",
        project.projectId,
        "creative_project",
        "failure",
        { error: String(err) },
      );
    });

    // Document-producing projects need their cover/inline images before the
    // PDF can render meaningfully, so the pdf_export job is only enqueued
    // once the (fire-and-forget) image pipeline has settled — success or
    // failure. A failed image pipeline still lets the document render;
    // the mapper simply omits the cover image section.
    if (isDocumentProject) {
      imagesDone.finally(() => {
        enqueue({
          jobType: "pdf_export",
          payloadJson: { projectId: projectDbId, documentType },
          priority: 60,
        }).catch(async (err) => {
          console.error(`[pdf-export] Failed to enqueue pdf_export job for project ${project.projectId}:`, err);
          await logAudit(
            "creative-document-engine",
            "pdf_export_enqueue_failed",
            project.projectId,
            "creative_project",
            "failure",
            { error: String(err) },
          );
        });
      });
    }

    // Presentation-producing projects (e.g. Pitch Deck) need their cover/
    // supporting images before the PPTX can render meaningfully, so the
    // pptx_export job is only enqueued once the (fire-and-forget) image
    // pipeline has settled — success or failure. A failed image pipeline
    // still lets the deck render; the mapper simply omits the logo mark.
    if (isPresentationProject) {
      imagesDone.finally(() => {
        enqueue({
          jobType: "pptx_export",
          payloadJson: { projectId: projectDbId, presentationType },
          priority: 60,
        }).catch(async (err) => {
          console.error(`[pptx-export] Failed to enqueue pptx_export job for project ${project.projectId}:`, err);
          await logAudit(
            "creative-presentation-engine",
            "pptx_export_enqueue_failed",
            project.projectId,
            "creative_project",
            "failure",
            { error: String(err) },
          );
        });
      });
    }
  }
}
