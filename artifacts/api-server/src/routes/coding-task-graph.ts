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
  completeReviewedCodingWorkstream,
  LocalCodingMultiWorkerError,
} from "../services/localCodingMultiWorkerOrchestratorService.js";
import { dispatchReadyCodingWorkstreams } from "../services/localCodingMultiWorkerExecutionService.js";

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

const dispatchBodySchema = z
  .object({
    baseSha: z.string().regex(/^[0-9a-f]{40}$/i),
    maxParallel: z.number().int().min(1).max(8).optional(),
    leaseSeconds: z.number().int().min(30).max(900).optional(),
    workerPoolId: z.string().min(1).max(200).optional(),
  })
  .strict();

function sendKnownError(res: Response, error: unknown): boolean {
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

router.post(
  "/ai/coding/tasks/:id/task-graph/:graphId/workstreams/:workstreamId/complete",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const snapshot = await requireGraphForTask(
        params.data.id,
        params.data.graphId,
      );
      if (
        !snapshot.workstreams.some(
          (item) => item.id === params.data.workstreamId,
        )
      ) {
        throw new LocalCodingTaskGraphError(
          "Coding workstream was not found in this task graph.",
          "NOT_FOUND",
          { workstreamId: params.data.workstreamId },
        );
      }

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
