/**
 * productionPipelineService — V4.4 Creative Production Pipeline
 *
 * Orchestrates the 7-stage creative production workflow:
 *   1. creative_director  — Brand strategy + creative direction (brief workflow)
 *   2. copywriter         — Copy production (from brief workflow)
 *   3. designer           — Visual design (image designer pipeline)
 *   4. presentation       — Presentation/deck build (pptx_export job)
 *   5. qa                 — Quality assurance (QC review from brief workflow)
 *   6. renderer           — Document render (pdf_export job)
 *   7. customer_review    — Customer review gateway
 *
 * Design principles:
 *  - Warm-start: if a stage's work is already done, it completes instantly.
 *  - Retry: each stage can be independently retried.
 *  - Additive: does NOT modify existing brief workflow or other services.
 *  - Non-blocking: heavy stages run fire-and-forget; pipeline records the trigger.
 */

import { eq, desc, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  creativeAiAssetsTable,
  aiProductionPipelinesTable,
  aiPipelineStagesTable,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { enqueue } from "./queueManagerService.js";
import { resolveProjectDocumentType } from "./creativeProjectDocumentType.js";
import { resolveProjectPresentationType } from "./creativeProjectPresentationType.js";

// ── Stage definitions ─────────────────────────────────────────────────────────

export interface PipelineStageDefinition {
  name: string;
  order: number;
  label: string;
}

export const PRODUCTION_STAGES: PipelineStageDefinition[] = [
  { name: "creative_director", order: 1, label: "Creative Direction" },
  { name: "copywriter",        order: 2, label: "Copy Production" },
  { name: "designer",          order: 3, label: "Visual Design" },
  { name: "presentation",      order: 4, label: "Presentation Build" },
  { name: "qa",                order: 5, label: "Quality Assurance" },
  { name: "renderer",          order: 6, label: "Document Render" },
  { name: "customer_review",   order: 7, label: "Customer Review Gate" },
];

// Stage name → brief workflow step label mapping
const BRIEF_STEP_MAP: Record<string, string> = {
  creative_director: "Creative Direction",
  copywriter: "Copy Production",
  qa: "Quality Control",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowMs(): number {
  return Date.now();
}

async function markStageRunning(stageDbId: number): Promise<void> {
  await db
    .update(aiPipelineStagesTable)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(aiPipelineStagesTable.id, stageDbId));
}

async function markStageCompleted(
  stageDbId: number,
  startMs: number,
  output?: Record<string, unknown>,
  meta?: { agentSlug?: string; model?: string; provider?: string },
): Promise<void> {
  const latencyMs = Date.now() - startMs;
  await db
    .update(aiPipelineStagesTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      latencyMs,
      output: output ?? null,
      agentSlug: meta?.agentSlug ?? null,
      model: meta?.model ?? null,
      provider: meta?.provider ?? null,
    })
    .where(eq(aiPipelineStagesTable.id, stageDbId));
}

async function markStageFailed(
  stageDbId: number,
  startMs: number,
  errorMessage: string,
): Promise<void> {
  const latencyMs = Date.now() - startMs;
  await db
    .update(aiPipelineStagesTable)
    .set({
      status: "failed",
      completedAt: new Date(),
      latencyMs,
      errorMessage,
    })
    .where(eq(aiPipelineStagesTable.id, stageDbId));
}

async function markStageSkipped(stageDbId: number, reason: string): Promise<void> {
  await db
    .update(aiPipelineStagesTable)
    .set({ status: "skipped", completedAt: new Date(), output: { _skipped: true, reason } as unknown as Record<string, unknown> })
    .where(eq(aiPipelineStagesTable.id, stageDbId));
}

async function updatePipelineCurrentStage(pipelineDbId: number, stageName: string): Promise<void> {
  await db
    .update(aiProductionPipelinesTable)
    .set({ currentStage: stageName, status: "running" })
    .where(eq(aiProductionPipelinesTable.id, pipelineDbId));
}

// ── Stage executors ───────────────────────────────────────────────────────────

/** Stage 1: creative_director — run brief workflow OR detect existing steps */
async function executeCreativeDirectorStage(
  stageDbId: number,
  project: typeof creativeProjectsTable.$inferSelect,
): Promise<boolean> {
  const startMs = nowMs();
  await markStageRunning(stageDbId);

  try {
    // Warm-start: check if brief workflow has already produced creative direction
    const [existingStep] = await db
      .select()
      .from(creativeProjectStepsTable)
      .where(
        and(
          eq(creativeProjectStepsTable.projectId, project.id),
          eq(creativeProjectStepsTable.stepName, "Creative Direction"),
          eq(creativeProjectStepsTable.status, "completed"),
        ),
      )
      .limit(1);

    if (existingStep) {
      await markStageCompleted(stageDbId, startMs, existingStep.output as Record<string, unknown> ?? {}, {
        agentSlug: "creative-director",
        model: existingStep.model ?? undefined,
        provider: existingStep.provider ?? undefined,
      });
      return true;
    }

    // Cold start: run the full creative brief workflow (all 4 agents).
    // This handles brand-strategist → creative-director → copywriter → quality-control.
    const { runCreativeBriefWorkflow } = await import("./creativeWorkflowRunner.js");
    await runCreativeBriefWorkflow(project.id);

    // Fetch the newly created creative direction step
    const [completedStep] = await db
      .select()
      .from(creativeProjectStepsTable)
      .where(
        and(
          eq(creativeProjectStepsTable.projectId, project.id),
          eq(creativeProjectStepsTable.stepName, "Creative Direction"),
        ),
      )
      .limit(1);

    if (!completedStep || completedStep.status === "failed") {
      await markStageFailed(stageDbId, startMs, "Creative brief workflow failed or produced no creative direction step");
      return false;
    }

    await markStageCompleted(stageDbId, startMs, completedStep.output as Record<string, unknown> ?? {}, {
      agentSlug: "creative-director",
      model: completedStep.model ?? undefined,
      provider: completedStep.provider ?? undefined,
    });
    return true;
  } catch (err) {
    await markStageFailed(stageDbId, startMs, String(err));
    return false;
  }
}

/** Stages 2, 5: warm-start from existing brief workflow step */
async function executeBriefDerivedStage(
  stageDbId: number,
  stageName: string,
  project: typeof creativeProjectsTable.$inferSelect,
): Promise<boolean> {
  const startMs = nowMs();
  await markStageRunning(stageDbId);

  const briefStepLabel = BRIEF_STEP_MAP[stageName];
  if (!briefStepLabel) {
    await markStageFailed(stageDbId, startMs, `Unknown brief-derived stage: ${stageName}`);
    return false;
  }

  try {
    const [step] = await db
      .select()
      .from(creativeProjectStepsTable)
      .where(
        and(
          eq(creativeProjectStepsTable.projectId, project.id),
          eq(creativeProjectStepsTable.stepName, briefStepLabel),
        ),
      )
      .limit(1);

    if (!step) {
      await markStageFailed(stageDbId, startMs, `No "${briefStepLabel}" step found — ensure the creative director stage completed first`);
      return false;
    }

    if (step.status === "failed") {
      await markStageFailed(stageDbId, startMs, `Brief workflow step "${briefStepLabel}" failed: ${step.errorMessage ?? "unknown error"}`);
      return false;
    }

    await markStageCompleted(stageDbId, startMs, step.output as Record<string, unknown> ?? {}, {
      agentSlug: stageName === "qa" ? "quality-control" : stageName,
      model: step.model ?? undefined,
      provider: step.provider ?? undefined,
    });
    return true;
  } catch (err) {
    await markStageFailed(stageDbId, startMs, String(err));
    return false;
  }
}

/** Stage 3: designer — run image pipeline or detect existing assets */
async function executeDesignerStage(
  stageDbId: number,
  project: typeof creativeProjectsTable.$inferSelect,
): Promise<boolean> {
  const startMs = nowMs();
  await markStageRunning(stageDbId);

  try {
    // Warm-start: check for existing approved or pending assets
    const [existing] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(creativeAiAssetsTable)
      .where(
        and(
          eq(creativeAiAssetsTable.projectId, project.projectId),
          sql`status NOT IN ('rejected')`,
        ),
      );

    if ((existing?.count ?? 0) > 0) {
      await markStageCompleted(stageDbId, startMs, { _warmStart: true, assetCount: existing.count }, {
        agentSlug: "image-designer",
      });
      return true;
    }

    // Cold start: trigger image designer pipeline fire-and-forget
    const { runImageDesignerPipeline } = await import("./imageDesignerService.js");
    await runImageDesignerPipeline(project.id, project.projectId, 2);

    await markStageCompleted(stageDbId, startMs, { triggered: true, variations: 2 }, {
      agentSlug: "image-designer",
    });
    return true;
  } catch (err) {
    await markStageFailed(stageDbId, startMs, String(err));
    return false;
  }
}

/** Stage 4: presentation — enqueue pptx_export if applicable */
async function executePresentationStage(
  stageDbId: number,
  project: typeof creativeProjectsTable.$inferSelect,
): Promise<boolean> {
  const startMs = nowMs();
  await markStageRunning(stageDbId);

  try {
    // Check if project needs a presentation
    const presentationType = await resolveProjectPresentationType(project);
    if (!presentationType) {
      await markStageSkipped(stageDbId, "Project type does not require a presentation build");
      return true;
    }

    // Check if already rendering
    if (project.status === "generating_presentation") {
      await markStageCompleted(stageDbId, startMs, { _warmStart: true, status: "generating_presentation" });
      return true;
    }

    // Enqueue the PPTX export job
    await enqueue({
      jobType: "pptx_export",
      payloadJson: { projectId: project.id, presentationType },
      priority: 60,
    });

    await markStageCompleted(stageDbId, startMs, { triggered: true, presentationType });
    return true;
  } catch (err) {
    await markStageFailed(stageDbId, startMs, String(err));
    return false;
  }
}

/** Stage 6: renderer — enqueue pdf_export if applicable */
async function executeRendererStage(
  stageDbId: number,
  project: typeof creativeProjectsTable.$inferSelect,
): Promise<boolean> {
  const startMs = nowMs();
  await markStageRunning(stageDbId);

  try {
    // Check if project needs a document
    const documentType = await resolveProjectDocumentType(project);
    if (!documentType) {
      await markStageSkipped(stageDbId, "Project type does not require document rendering");
      return true;
    }

    // Check if already rendering
    if (project.status === "generating_document") {
      await markStageCompleted(stageDbId, startMs, { _warmStart: true, status: "generating_document" });
      return true;
    }

    // Enqueue the PDF export job
    await enqueue({
      jobType: "pdf_export",
      payloadJson: { projectId: project.id, documentType },
      priority: 60,
    });

    await markStageCompleted(stageDbId, startMs, { triggered: true, documentType });
    return true;
  } catch (err) {
    await markStageFailed(stageDbId, startMs, String(err));
    return false;
  }
}

/** Stage 7: customer_review — move project to waiting_client_review */
async function executeCustomerReviewStage(
  stageDbId: number,
  project: typeof creativeProjectsTable.$inferSelect,
): Promise<boolean> {
  const startMs = nowMs();
  await markStageRunning(stageDbId);

  const terminalStatuses = new Set([
    "waiting_client_review", "revision", "approved", "completed",
  ]);

  try {
    if (!terminalStatuses.has(project.status)) {
      await db
        .update(creativeProjectsTable)
        .set({ status: "waiting_client_review" })
        .where(eq(creativeProjectsTable.id, project.id));
    }

    await markStageCompleted(stageDbId, startMs, {
      projectStatus: "waiting_client_review",
      _warmStart: terminalStatuses.has(project.status),
    });
    return true;
  } catch (err) {
    await markStageFailed(stageDbId, startMs, String(err));
    return false;
  }
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

async function orchestratePipeline(pipelineDbId: number): Promise<void> {
  const [pipeline] = await db
    .select()
    .from(aiProductionPipelinesTable)
    .where(eq(aiProductionPipelinesTable.id, pipelineDbId));

  if (!pipeline) throw new Error(`Pipeline ${pipelineDbId} not found`);

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, pipeline.projectId));

  if (!project) throw new Error(`Project for pipeline ${pipelineDbId} not found`);

  const stages = await db
    .select()
    .from(aiPipelineStagesTable)
    .where(eq(aiPipelineStagesTable.runId, pipelineDbId))
    .orderBy(aiPipelineStagesTable.stageOrder);

  await db
    .update(aiProductionPipelinesTable)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(aiProductionPipelinesTable.id, pipelineDbId));

  let anyFailed = false;
  const stageStats: Record<string, { latencyMs: number; status: string }> = {};

  for (const stage of stages) {
    // Skip already-completed or skipped stages (for retry scenarios)
    if (stage.status === "completed" || stage.status === "skipped") {
      stageStats[stage.stageName] = { latencyMs: stage.latencyMs ?? 0, status: stage.status };
      continue;
    }

    await updatePipelineCurrentStage(pipelineDbId, stage.stageName);

    let success = false;

    switch (stage.stageName) {
      case "creative_director":
        success = await executeCreativeDirectorStage(stage.id, project);
        break;
      case "copywriter":
      case "qa":
        success = await executeBriefDerivedStage(stage.id, stage.stageName, project);
        break;
      case "designer":
        success = await executeDesignerStage(stage.id, project);
        break;
      case "presentation":
        success = await executePresentationStage(stage.id, project);
        break;
      case "renderer":
        success = await executeRendererStage(stage.id, project);
        break;
      case "customer_review":
        success = await executeCustomerReviewStage(stage.id, project);
        break;
      default:
        await markStageFailed(stage.id, Date.now(), `Unknown stage: ${stage.stageName}`);
        success = false;
    }

    // Re-read stage for latency
    const [refreshed] = await db
      .select()
      .from(aiPipelineStagesTable)
      .where(eq(aiPipelineStagesTable.id, stage.id));
    stageStats[stage.stageName] = {
      latencyMs: refreshed?.latencyMs ?? 0,
      status: refreshed?.status ?? "unknown",
    };

    if (!success) {
      anyFailed = true;
      // Stop pipeline on first failure
      break;
    }
  }

  // Build execution summary
  const allStages = await db
    .select()
    .from(aiPipelineStagesTable)
    .where(eq(aiPipelineStagesTable.runId, pipelineDbId));

  const summary = {
    totalStages: allStages.length,
    completedStages: allStages.filter((s) => s.status === "completed").length,
    failedStages: allStages.filter((s) => s.status === "failed").length,
    skippedStages: allStages.filter((s) => s.status === "skipped").length,
    pendingStages: allStages.filter((s) => s.status === "pending").length,
    totalLatencyMs: allStages.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0),
    stageBreakdown: stageStats,
  };

  const finalStatus = anyFailed ? "failed" : "completed";
  await db
    .update(aiProductionPipelinesTable)
    .set({
      status: finalStatus,
      currentStage: anyFailed ? undefined : null,
      completedAt: new Date(),
      executionSummary: summary as unknown as Record<string, unknown>,
    })
    .where(eq(aiProductionPipelinesTable.id, pipelineDbId));

  await logAudit(
    "production-pipeline",
    `pipeline_${finalStatus}`,
    pipeline.runId,
    "ai_production_pipeline",
    anyFailed ? "failure" : "success",
    { projectId: project.projectId, summary },
  );

  publishSafe({
    eventType: `production.pipeline.${finalStatus}`,
    sourceModule: "production-pipeline",
    sourceId: pipeline.runId,
    payload: { runId: pipeline.runId, projectId: project.projectId, summary },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startProductionPipeline(
  projectDbId: number,
  options?: { forceRestart?: boolean },
): Promise<{ runId: string }> {
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));

  if (!project) throw new Error(`Project ${projectDbId} not found`);

  // Check for active pipeline (unless forceRestart)
  if (!options?.forceRestart) {
    const [active] = await db
      .select()
      .from(aiProductionPipelinesTable)
      .where(
        and(
          eq(aiProductionPipelinesTable.projectId, projectDbId),
          sql`status IN ('pending', 'running')`,
        ),
      )
      .limit(1);

    if (active) {
      throw new Error(`Pipeline already running for this project (runId: ${active.runId}). Use forceRestart=true to override.`);
    }
  }

  const runId = randomUUID();

  // Create pipeline record
  const [pipeline] = await db
    .insert(aiProductionPipelinesTable)
    .values({ runId, projectId: projectDbId, status: "pending" })
    .returning();

  // Create all stage records
  await db.insert(aiPipelineStagesTable).values(
    PRODUCTION_STAGES.map((s) => ({
      runId: pipeline.id,
      stageName: s.name,
      stageOrder: s.order,
      status: "pending" as const,
    })),
  );

  await logAudit(
    "production-pipeline",
    "pipeline_started",
    runId,
    "ai_production_pipeline",
    "success",
    { projectId: project.projectId, projectDbId },
  );

  // Fire-and-forget orchestration
  orchestratePipeline(pipeline.id).catch(async (err) => {
    console.error(`[production-pipeline] Orchestrator crashed for run ${runId}:`, err);
    await db
      .update(aiProductionPipelinesTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: String(err),
      })
      .where(eq(aiProductionPipelinesTable.id, pipeline.id));
    await logAudit(
      "production-pipeline",
      "orchestrator_crash",
      runId,
      "ai_production_pipeline",
      "failure",
      { error: String(err) },
    );
  });

  return { runId };
}

export async function getPipelineByRunId(runId: string) {
  const [pipeline] = await db
    .select()
    .from(aiProductionPipelinesTable)
    .where(eq(aiProductionPipelinesTable.runId, runId));

  if (!pipeline) return null;

  const stages = await db
    .select()
    .from(aiPipelineStagesTable)
    .where(eq(aiPipelineStagesTable.runId, pipeline.id))
    .orderBy(aiPipelineStagesTable.stageOrder);

  return { ...pipeline, stages };
}

export async function getProjectPipelines(projectDbId: number) {
  const pipelines = await db
    .select()
    .from(aiProductionPipelinesTable)
    .where(eq(aiProductionPipelinesTable.projectId, projectDbId))
    .orderBy(desc(aiProductionPipelinesTable.createdAt));

  return pipelines;
}

export async function retryPipelineStage(
  runId: string,
  stageName?: string,
): Promise<{ retried: boolean; stageName?: string }> {
  const [pipeline] = await db
    .select()
    .from(aiProductionPipelinesTable)
    .where(eq(aiProductionPipelinesTable.runId, runId));

  if (!pipeline) throw new Error(`Pipeline ${runId} not found`);
  if (pipeline.status === "running") throw new Error("Pipeline is already running");
  if (pipeline.status === "cancelled") throw new Error("Cannot retry a cancelled pipeline");

  // Find the stage to retry (specified, or first failed)
  const stages = await db
    .select()
    .from(aiPipelineStagesTable)
    .where(eq(aiPipelineStagesTable.runId, pipeline.id))
    .orderBy(aiPipelineStagesTable.stageOrder);

  let targetStage = stageName
    ? stages.find((s) => s.stageName === stageName)
    : stages.find((s) => s.status === "failed");

  if (!targetStage) {
    return { retried: false };
  }

  // Reset target stage and all stages after it to pending
  const targetOrder = targetStage.stageOrder;
  const stageIdsToReset = stages
    .filter((s) => s.stageOrder >= targetOrder)
    .map((s) => s.id);

  for (const id of stageIdsToReset) {
    await db
      .update(aiPipelineStagesTable)
      .set({
        status: "pending",
        startedAt: null,
        completedAt: null,
        latencyMs: null,
        errorMessage: null,
        output: null,
      })
      .where(eq(aiPipelineStagesTable.id, id));
  }

  // Increment pipeline retry count and reset status
  await db
    .update(aiProductionPipelinesTable)
    .set({
      status: "pending",
      errorMessage: null,
      retryCount: pipeline.retryCount + 1,
    })
    .where(eq(aiProductionPipelinesTable.id, pipeline.id));

  await logAudit(
    "production-pipeline",
    "pipeline_retry",
    runId,
    "ai_production_pipeline",
    "success",
    { stageName: targetStage.stageName, retryCount: pipeline.retryCount + 1 },
  );

  // Fire-and-forget orchestration
  orchestratePipeline(pipeline.id).catch(async (err) => {
    console.error(`[production-pipeline] Retry orchestrator crashed for run ${runId}:`, err);
    await db
      .update(aiProductionPipelinesTable)
      .set({ status: "failed", completedAt: new Date(), errorMessage: String(err) })
      .where(eq(aiProductionPipelinesTable.id, pipeline.id));
  });

  return { retried: true, stageName: targetStage.stageName };
}

export async function cancelPipeline(runId: string): Promise<void> {
  const [pipeline] = await db
    .select()
    .from(aiProductionPipelinesTable)
    .where(eq(aiProductionPipelinesTable.runId, runId));

  if (!pipeline) throw new Error(`Pipeline ${runId} not found`);
  if (pipeline.status === "completed") throw new Error("Cannot cancel a completed pipeline");

  await db
    .update(aiProductionPipelinesTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(aiProductionPipelinesTable.id, pipeline.id));

  // Mark all pending/running stages as skipped
  await db
    .update(aiPipelineStagesTable)
    .set({ status: "skipped", completedAt: new Date(), output: { _cancelled: true } as unknown as Record<string, unknown> })
    .where(
      and(
        eq(aiPipelineStagesTable.runId, pipeline.id),
        sql`status IN ('pending', 'running')`,
      ),
    );

  await logAudit("production-pipeline", "pipeline_cancelled", runId, "ai_production_pipeline", "success", {});
}

export async function getPipelineMonitoringStats() {
  const [totals] = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      runningRuns: sql<number>`count(*) filter (where status = 'running')::int`,
      completedRuns: sql<number>`count(*) filter (where status = 'completed')::int`,
      failedRuns: sql<number>`count(*) filter (where status = 'failed')::int`,
      cancelledRuns: sql<number>`count(*) filter (where status = 'cancelled')::int`,
      pendingRuns: sql<number>`count(*) filter (where status = 'pending')::int`,
    })
    .from(aiProductionPipelinesTable);

  // Per-stage stats
  const stageStats = await db
    .select({
      stageName: aiPipelineStagesTable.stageName,
      totalCount: sql<number>`count(*)::int`,
      completedCount: sql<number>`count(*) filter (where status = 'completed')::int`,
      failedCount: sql<number>`count(*) filter (where status = 'failed')::int`,
      skippedCount: sql<number>`count(*) filter (where status = 'skipped')::int`,
      avgLatencyMs: sql<number | null>`avg(latency_ms)::float`,
    })
    .from(aiPipelineStagesTable)
    .groupBy(aiPipelineStagesTable.stageName);

  // Recent runs (last 10)
  const recentRuns = await db
    .select()
    .from(aiProductionPipelinesTable)
    .orderBy(desc(aiProductionPipelinesTable.createdAt))
    .limit(10);

  return {
    totals: {
      totalRuns: totals?.totalRuns ?? 0,
      runningRuns: totals?.runningRuns ?? 0,
      completedRuns: totals?.completedRuns ?? 0,
      failedRuns: totals?.failedRuns ?? 0,
      cancelledRuns: totals?.cancelledRuns ?? 0,
      pendingRuns: totals?.pendingRuns ?? 0,
    },
    stageStats,
    recentRuns,
  };
}
