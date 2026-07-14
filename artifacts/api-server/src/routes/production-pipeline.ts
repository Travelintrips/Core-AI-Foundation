/**
 * production-pipeline routes — V4.4 Creative Production Pipeline
 *
 * Endpoints (all under tag: production-pipeline):
 *   POST /creative-ai/production-pipeline                — start pipeline
 *   GET  /creative-ai/production-pipeline/monitoring     — monitoring stats
 *   GET  /creative-ai/production-pipeline/:runId         — pipeline detail + stages
 *   GET  /creative-ai/production-pipeline/:runId/stages  — stages list
 *   POST /creative-ai/production-pipeline/:runId/retry   — retry failed stage
 *   POST /creative-ai/production-pipeline/:runId/cancel  — cancel pipeline
 *   GET  /creative-ai/projects/:projectId/pipeline       — list runs for a project
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, creativeProjectsTable } from "@workspace/db";
import {
  StartProductionPipelineBody,
  StartProductionPipelineResponse,
  GetPipelineMonitoringStatsResponse,
  GetProductionPipelineParams,
  GetProductionPipelineResponse,
  ListProductionPipelineStagesParams,
  ListProductionPipelineStagesResponse,
  RetryPipelineStageParams,
  RetryPipelineStageBody,
  RetryPipelineStageResponse,
  CancelProductionPipelineParams,
  CancelProductionPipelineResponse,
  ListProjectPipelineRunsParams,
  ListProjectPipelineRunsResponse,
} from "@workspace/api-zod";
import {
  startProductionPipeline,
  getPipelineByRunId,
  getProjectPipelines,
  retryPipelineStage,
  cancelPipeline,
  getPipelineMonitoringStats,
  PRODUCTION_STAGES,
} from "../services/productionPipelineService.js";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

// ── Serializers ───────────────────────────────────────────────────────────────

type PipelineRow = Awaited<ReturnType<typeof getPipelineMonitoringStats>>["recentRuns"][number];
type DetailRow = NonNullable<Awaited<ReturnType<typeof getPipelineByRunId>>>;
type StageRow = DetailRow["stages"][number];

function serializePipelineBase(p: PipelineRow) {
  return {
    ...p,
    startedAt: p.startedAt?.toISOString() ?? null,
    completedAt: p.completedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeStage(s: StageRow) {
  return {
    ...s,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function serializePipelineDetail(d: DetailRow) {
  return {
    ...serializePipelineBase(d),
    stages: d.stages.map(serializeStage),
  };
}

/** Resolve a project by integer id or UUID project_id string. */
async function resolveProject(projectIdParam: string) {
  const isInt = /^\d+$/.test(projectIdParam);
  const [project] = isInt
    ? await db
        .select()
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.id, Number(projectIdParam)))
        .limit(1)
    : await db
        .select()
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.projectId, projectIdParam))
        .limit(1);
  return project ?? null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** POST /creative-ai/production-pipeline — start a production pipeline */
router.post("/creative-ai/production-pipeline", async (req, res): Promise<void> => {
  const parsed = StartProductionPipelineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, forceRestart } = parsed.data;
  const project = await resolveProject(String(projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    const { runId } = await startProductionPipeline(project.id, { forceRestart: forceRestart ?? false });
    const detail = await getPipelineByRunId(runId);

    await logAudit(
      "production-pipeline",
      "pipeline_start_requested",
      runId,
      "ai_production_pipeline",
      "success",
      { projectId: project.projectId },
    );

    res.status(202).json(
      StartProductionPipelineResponse.parse({
        runId,
        message: `Production pipeline started for project ${project.projectId}`,
        pipeline: serializePipelineBase(detail!),
      }),
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("already running")) {
      res.status(409).json({ error: msg });
    } else {
      console.error("[production-pipeline] Failed to start:", err);
      res.status(500).json({ error: "Failed to start production pipeline" });
    }
  }
});

/** GET /creative-ai/production-pipeline/monitoring — aggregate monitoring stats */
// NOTE: This route MUST be registered before /:runId to avoid param capture
router.get("/creative-ai/production-pipeline/monitoring", async (_req, res): Promise<void> => {
  try {
    const stats = await getPipelineMonitoringStats();
    res.json(
      GetPipelineMonitoringStatsResponse.parse({
        totals: stats.totals,
        stageStats: stats.stageStats.map((s) => ({
          stageName: s.stageName,
          totalCount: s.totalCount,
          completedCount: s.completedCount,
          failedCount: s.failedCount,
          skippedCount: s.skippedCount,
          avgLatencyMs: s.avgLatencyMs != null ? Number(s.avgLatencyMs) : null,
        })),
        recentRuns: stats.recentRuns.map(serializePipelineBase),
        stageDefinitions: PRODUCTION_STAGES,
      }),
    );
  } catch (err) {
    console.error("[production-pipeline] Monitoring stats error:", err);
    res.status(500).json({ error: "Failed to load monitoring stats" });
  }
});

/** GET /creative-ai/production-pipeline/:runId — pipeline detail with all stages */
router.get("/creative-ai/production-pipeline/:runId", async (req, res): Promise<void> => {
  const params = GetProductionPipelineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const detail = await getPipelineByRunId(params.data.runId);
  if (!detail) {
    res.status(404).json({ error: "Pipeline not found" });
    return;
  }

  res.json(GetProductionPipelineResponse.parse(serializePipelineDetail(detail)));
});

/** GET /creative-ai/production-pipeline/:runId/stages — stages list */
router.get("/creative-ai/production-pipeline/:runId/stages", async (req, res): Promise<void> => {
  const params = ListProductionPipelineStagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const detail = await getPipelineByRunId(params.data.runId);
  if (!detail) {
    res.status(404).json({ error: "Pipeline not found" });
    return;
  }

  res.json(ListProductionPipelineStagesResponse.parse(detail.stages.map(serializeStage)));
});

/** POST /creative-ai/production-pipeline/:runId/retry — retry from a failed stage */
router.post("/creative-ai/production-pipeline/:runId/retry", async (req, res): Promise<void> => {
  const params = RetryPipelineStageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawBody = req.body && Object.keys(req.body).length > 0 ? req.body : {};
  const body = RetryPipelineStageBody.safeParse(rawBody);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const result = await retryPipelineStage(
      params.data.runId,
      body.data.stageName ?? undefined,
    );
    res.json(
      RetryPipelineStageResponse.parse({
        runId: params.data.runId,
        retried: result.retried,
        stageName: result.stageName ?? null,
        message: result.retried
          ? `Retrying pipeline from stage: ${result.stageName}`
          : "No failed stage found to retry",
      }),
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("already running") || msg.includes("cancelled")) {
      res.status(409).json({ error: msg });
    } else {
      res.status(500).json({ error: "Failed to retry pipeline" });
    }
  }
});

/** POST /creative-ai/production-pipeline/:runId/cancel — cancel a pipeline */
router.post("/creative-ai/production-pipeline/:runId/cancel", async (req, res): Promise<void> => {
  const params = CancelProductionPipelineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    await cancelPipeline(params.data.runId);
    res.json(
      CancelProductionPipelineResponse.parse({
        runId: params.data.runId,
        status: "cancelled",
        message: "Pipeline cancelled successfully",
      }),
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("completed")) {
      res.status(409).json({ error: msg });
    } else if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
    } else {
      res.status(500).json({ error: "Failed to cancel pipeline" });
    }
  }
});

/** GET /creative-ai/projects/:projectId/pipeline — list pipeline runs for a project */
router.get("/creative-ai/projects/:projectId/pipeline", async (req, res): Promise<void> => {
  const params = ListProjectPipelineRunsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const project = await resolveProject(String(params.data.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const pipelines = await getProjectPipelines(project.id);
  res.json(ListProjectPipelineRunsResponse.parse(pipelines.map(serializePipelineBase)));
});

export default router;
