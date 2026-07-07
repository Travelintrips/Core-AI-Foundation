/**
 * creativeWorkflowRunner — executes the 4-agent Creative Brief workflow.
 *
 * Runs in the background (fire-and-forget after HTTP response).
 * Each step result is persisted to DB as it completes.
 * Step failures are recorded but do NOT abort the workflow — downstream
 * agents receive whatever previous output is available.
 */

import { eq } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  aiAgentsTable,
} from "@workspace/db";
import { executeAI } from "./aiExecutionService.js";
import { getAllActiveModels } from "./aiModelService.js";
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

type StepOutput = Record<string, unknown>;

interface AgentStep {
  slug: string;
  label: string;
}

const PIPELINE: AgentStep[] = [
  { slug: "brand-strategist", label: "Brand Strategy" },
  { slug: "creative-director", label: "Creative Direction" },
  { slug: "copywriter", label: "Copy Production" },
  { slug: "quality-control", label: "Quality Control" },
];

/** Resolve the best model+provider for a given agent. Falls back to any available model. */
async function resolveModelForAgent(agent: typeof aiAgentsTable.$inferSelect) {
  if (agent.modelId) {
    const models = await getAllActiveModels();
    const match = models.find((m) => m.model.id === agent.modelId);
    if (match && getProviderApiKey(match.provider.slug)) return match;
  }
  // fallback: first model with an API key
  const models = await getAllActiveModels();
  return models.find((m) => !!getProviderApiKey(m.provider.slug)) ?? null;
}

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
  let anyFailed = false;

  for (const step of PIPELINE) {
    // Load agent from DB
    const [agent] = await db
      .select()
      .from(aiAgentsTable)
      .where(eq(aiAgentsTable.slug, step.slug));

    // Create step record
    const [stepRecord] = await db
      .insert(creativeProjectStepsTable)
      .values({
        projectId: projectDbId,
        agentId: agent?.id ?? null,
        stepName: step.label,
        input: brief as unknown as Record<string, unknown>,
        status: "running",
      })
      .returning();

    try {
      // Resolve model
      const modelPair = agent ? await resolveModelForAgent(agent) : null;
      if (!modelPair) {
        throw new Error(
          `No active model with a configured API key available for step '${step.label}'`,
        );
      }

      // Build prompt
      const { systemPrompt, userPrompt } = buildPromptForStep(step.slug, brief, stepOutputs);

      // Get agent temperature if available
      const temperature = agent?.temperature ? parseFloat(agent.temperature) : 0.7;
      const maxTokens = agent?.maxTokens ?? 4096;

      // Execute AI
      const result = await executeAI({
        prompt: userPrompt,
        systemPrompt,
        model: modelPair.model,
        provider: modelPair.provider,
        temperature,
        maxTokens,
      });

      // Parse JSON output
      let parsedOutput: StepOutput;
      try {
        parsedOutput = parseJsonResponse(result.content);
      } catch {
        // AI returned non-JSON — wrap it
        parsedOutput = { raw: result.content };
      }

      stepOutputs[step.slug] = parsedOutput;

      // Update step as completed
      await db
        .update(creativeProjectStepsTable)
        .set({
          output: parsedOutput,
          provider: modelPair.provider.slug,
          model: modelPair.model.modelId,
          tokenUsage: result.tokensUsed,
          latencyMs: result.latencyMs,
          status: "completed",
        })
        .where(eq(creativeProjectStepsTable.id, stepRecord.id));

      await logAudit("creative-ai", `step_completed:${step.slug}`, String(projectDbId), "creative_project", "success", {
        step: step.label,
        model: modelPair.model.modelId,
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
      });
    } catch (err) {
      anyFailed = true;
      const errorMessage = String(err);

      await db
        .update(creativeProjectStepsTable)
        .set({
          status: "failed",
          errorMessage,
        })
        .where(eq(creativeProjectStepsTable.id, stepRecord.id));

      await logAudit("creative-ai", `step_failed:${step.slug}`, String(projectDbId), "creative_project", "failure", {
        step: step.label,
        error: errorMessage,
      });

      // Record empty output so downstream agents still run
      stepOutputs[step.slug] = {};
    }
  }

  // Aggregate all outputs into project.result
  const aggregatedResult = {
    brandStrategy: stepOutputs["brand-strategist"] ?? null,
    creativeDirection: stepOutputs["creative-director"] ?? null,
    copy: stepOutputs["copywriter"] ?? null,
    qcReview: stepOutputs["quality-control"] ?? null,
  };

  const finalStatus = anyFailed ? "completed" : "completed"; // completed even with partial failures
  await db
    .update(creativeProjectsTable)
    .set({
      status: finalStatus,
      result: aggregatedResult,
    })
    .where(eq(creativeProjectsTable.id, projectDbId));

  await logAudit("creative-ai", "workflow_completed", String(projectDbId), "creative_project", anyFailed ? "failure" : "success", {
    projectId: project.projectId,
    stepsCompleted: Object.keys(stepOutputs).length,
    anyFailed,
  });
}
