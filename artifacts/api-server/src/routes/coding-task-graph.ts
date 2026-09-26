import { Router, type Response } from "express";
import { z } from "zod";
import { GetCodingTaskParams } from "@workspace/api-zod";
import {
  approveCodingTaskGraph,
  getLatestCodingTaskGraph,
  LocalCodingTaskGraphError,
  persistCodingTaskGraph,
} from "../services/localCodingTaskGraphService.js";
import {
  AutomatedMultiTaskPlannerError,
  generateAndPersistCodingMultiTaskPlan,
} from "../services/localCodingAutomatedMultiTaskPlannerService.js";
import {
  completeReviewedCodingWorkstream,
  LocalCodingMultiWorkerError,
} from "../services/localCodingMultiWorkerOrchestratorService.js";
import {
  buildCodingIntegrationManifest,
  CodingIntegrationGateError,
} from "../services/localCodingMultiWorkerIntegrationGateService.js";
import { dispatchReadyCodingWorkstreams } from "../services/localCodingMultiWorkerExecutionService.js";
import {
  getLatestWorkstreamAiHandoff,
  LocalCodingWorkstreamAiHandoffError,
} from "../services/localCodingWorkstreamAiHandoffService.js";
import {
  approveWorkstreamAiCandidatePatch,
  approveWorkstreamAiExecutionHandoff,
  enqueueWorkstreamAiExecution,
  LocalCodingWorkstreamAiExecutionError,
  materializeApprovedWorkstreamAiCandidate,
  prepareWorkstreamAiExecutionHandoff,
  revokeWorkstreamAiExecutionHandoff,
} from "../services/localCodingWorkstreamAiExecutionService.js";

const router = Router();

const graphParamsSchema = z.object({
  id: z.string().uuid(),
  graphId: z.string().uuid(),
});

const workstreamParamsSchema = z.object({
  id: z.string().uuid(),
  graphId: z.string().uuid(),
  workstreamId: z.string().uuid(),
});

const workstreamHandoffParamsSchema = workstreamParamsSchema.extend({
  handoffId: z.string().uuid(),
});

const runWorkstreamAiBodySchema = z
  .object({
    expectedPackageHash: z.string().regex(/^[0-9a-f]{64}$/i),
    requestedBy: z.string().min(1).max(200).optional(),
  })
  .strict();

const dispatchBodySchema = z
  .object({
    baseSha: z.string().regex(/^[0-9a-f]{40}$/i),
    maxParallel: z.number().int().min(1).max(8).optional(),
    leaseSeconds: z.number().int().min(30).max(900).optional(),
    workerPoolId: z.string().min(1).max(200).optional(),
  })
  .strict();

function sendKnownError(res: Response, error: unknown): boolean {
  if (error instanceof AutomatedMultiTaskPlannerError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : ["ANALYSIS_REQUIRED", "ACTIVE_GRAPH_EXISTS", "AUTHORITY_HELD", "AUTHORITY_LOST"].includes(error.code)
          ? 409
          : error.code === "MODEL_UNAVAILABLE"
            ? 503
            : error.code === "MODEL_FAILED"
              ? 502
              : 422;
    res.status(status).json({
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
    return true;
  }

  if (error instanceof LocalCodingTaskGraphError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : ["NOT_READY", "ACTIVE_GRAPH_EXISTS"].includes(error.code)
          ? 409
          : 422;
    res.status(status).json({
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
    return true;
  }

  if (error instanceof CodingIntegrationGateError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "NOT_READY"
          ? 409
          : 422;
    res.status(status).json({
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
    return true;
  }

  if (error instanceof LocalCodingMultiWorkerError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : ["NOT_READY", "LEASE_LOST"].includes(error.code)
          ? 409
          : 422;
    res.status(status).json({
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
    return true;
  }

  if (error instanceof LocalCodingWorkstreamAiHandoffError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : ["NOT_READY", "STALE_CLAIM", "STALE_CONTEXT", "EXPIRED", "REVOKED", "CONSUMED"].includes(error.code)
          ? 409
          : 422;
    res.status(status).json({
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
    return true;
  }

  if (error instanceof LocalCodingWorkstreamAiExecutionError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : ["NOT_READY", "STALE_CONTEXT", "LEASE_LOST"].includes(error.code)
          ? 409
          : 422;
    res.status(status).json({
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
    return true;
  }

  return false;
}

async function requireGraphForTask(
  taskId: string,
  graphId: string,
) {
  const snapshot = await getLatestCodingTaskGraph(taskId);
  if (!snapshot || snapshot.graph.id !== graphId) {
    throw new LocalCodingTaskGraphError(
      "Coding task graph was not found for this task.",
      "NOT_FOUND",
      { graphId },
    );
  }
  return snapshot;
}

async function requireWorkstreamForTaskGraph(
  taskId: string,
  graphId: string,
  workstreamId: string,
) {
  const snapshot = await requireGraphForTask(taskId, graphId);
  if (!snapshot.workstreams.some((item) => item.id === workstreamId)) {
    throw new LocalCodingTaskGraphError(
      "Coding workstream was not found in this task graph.",
      "NOT_FOUND",
      { workstreamId },
    );
  }
  return snapshot;
}

router.get(
  "/ai/coding/tasks/:id/task-graph",
  async (req, res): Promise<void> => {
    const params = GetCodingTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const snapshot = await getLatestCodingTaskGraph(params.data.id);
    if (!snapshot) {
      res.status(404).json({ error: "Coding task graph not found" });
      return;
    }
    res.json(snapshot);
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/generate",
  async (req, res): Promise<void> => {
    const params = GetCodingTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const result = await generateAndPersistCodingMultiTaskPlan(
        params.data.id,
      );
      const snapshot = await getLatestCodingTaskGraph(params.data.id);
      res.status(result.created ? 201 : 200).json({
        ...result,
        snapshot,
      });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph",
  async (req, res): Promise<void> => {
    const params = GetCodingTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const result = await persistCodingTaskGraph(params.data.id, req.body);
      const snapshot = await getLatestCodingTaskGraph(params.data.id);
      res.status(result.created ? 201 : 200).json({
        created: result.created,
        graph: result.graph,
        snapshot,
      });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.get(
  "/ai/coding/tasks/:id/task-graph/:graphId/integration-manifest",
  async (req, res): Promise<void> => {
    const params = graphParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const snapshot = await requireGraphForTask(
        params.data.id,
        params.data.graphId,
      );
      const manifest = buildCodingIntegrationManifest(
        params.data.id,
        snapshot,
      );
      res.json(manifest);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/approve",
  async (req, res): Promise<void> => {
    const params = graphParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const graph = await approveCodingTaskGraph(
        params.data.id,
        params.data.graphId,
      );
      res.json(graph);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/dispatch",
  async (req, res): Promise<void> => {
    const params = graphParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = dispatchBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    try {
      await requireGraphForTask(params.data.id, params.data.graphId);
      const result = await dispatchReadyCodingWorkstreams(
        params.data.graphId,
        {
          baseSha: body.data.baseSha,
          maxParallel: body.data.maxParallel,
          leaseSeconds: body.data.leaseSeconds,
          workerPoolId: body.data.workerPoolId,
        },
      );
      res.status(202).json(result);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.get(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/ai-handoff",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      await requireWorkstreamForTaskGraph(
        params.data.id,
        params.data.graphId,
        params.data.workstreamId,
      );
      const handoff = await getLatestWorkstreamAiHandoff(
        params.data.workstreamId,
      );
      if (!handoff) {
        res.status(404).json({ error: "Workstream AI handoff not found." });
        return;
      }
      res.json({
        handoffId: handoff.id,
        workstreamId: handoff.workstreamId,
        graphId: handoff.graphId,
        claimAttempt: handoff.claimAttempt,
        packageHash: handoff.packageHash,
        status: handoff.status,
        preparedAt: handoff.preparedAt?.toISOString() ?? null,
        approvedAt: handoff.approvedAt?.toISOString() ?? null,
        expiresAt: handoff.expiresAt?.toISOString() ?? null,
        revokedAt: handoff.revokedAt?.toISOString() ?? null,
        consumedAt: handoff.consumedAt?.toISOString() ?? null,
      });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/prepare-ai-handoff",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      await requireWorkstreamForTaskGraph(
        params.data.id,
        params.data.graphId,
        params.data.workstreamId,
      );
      const result = await prepareWorkstreamAiExecutionHandoff(
        params.data.workstreamId,
      );
      res.status(201).json(result);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/ai-handoff/:handoffId/approve",
  async (req, res): Promise<void> => {
    const params = workstreamHandoffParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      await requireWorkstreamForTaskGraph(
        params.data.id,
        params.data.graphId,
        params.data.workstreamId,
      );
      const lease = await approveWorkstreamAiExecutionHandoff(
        params.data.workstreamId,
        params.data.handoffId,
      );
      res.json(lease);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/revoke-ai-handoff",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      await requireWorkstreamForTaskGraph(
        params.data.id,
        params.data.graphId,
        params.data.workstreamId,
      );
      const result = await revokeWorkstreamAiExecutionHandoff(
        params.data.workstreamId,
      );
      res.json(result);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/run-ai-execution",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = runWorkstreamAiBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    try {
      await requireWorkstreamForTaskGraph(
        params.data.id,
        params.data.graphId,
        params.data.workstreamId,
      );
      const job = await enqueueWorkstreamAiExecution(
        params.data.workstreamId,
        body.data,
      );
      res.status(202).json({
        jobId: job.id,
        jobCode: job.jobCode,
        status: job.status,
        nextAction: "AI_EXECUTION_QUEUED",
      });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/approve-ai-patch",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      await requireWorkstreamForTaskGraph(
        params.data.id,
        params.data.graphId,
        params.data.workstreamId,
      );
      const workstream = await approveWorkstreamAiCandidatePatch(
        params.data.workstreamId,
      );
      res.json({
        workstreamId: workstream.id,
        status: workstream.status,
        resultJson: workstream.resultJson,
      });
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/complete",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      await requireWorkstreamForTaskGraph(
        params.data.id,
        params.data.graphId,
        params.data.workstreamId,
      );

      await materializeApprovedWorkstreamAiCandidate(
        params.data.workstreamId,
      );
      await completeReviewedCodingWorkstream(params.data.workstreamId);
      const refreshed = await getLatestCodingTaskGraph(params.data.id);
      res.json(refreshed);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      throw error;
    }
  },
);

export default router;
