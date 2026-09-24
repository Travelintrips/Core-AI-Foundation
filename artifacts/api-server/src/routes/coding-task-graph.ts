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
  completeManualCodingWorkstream,
  LocalCodingMultiWorkerError,
  reconcileCodingTaskGraph,
  startApprovedCodingTaskGraph,
} from "../services/localCodingMultiWorkerOrchestratorService.js";

const router = Router();

const graphParamsSchema = z.object({
  id: z.string().uuid(),
  graphId: z.string().uuid(),
});

const workstreamParamsSchema = z.object({
  id: z.string().uuid(),
  workstreamId: z.string().uuid(),
});

const concurrencySchema = z
  .object({
    maxParallel: z.number().int().min(1).max(8).optional(),
  })
  .strict();

function sendGraphError(
  res: Response,
  error: unknown,
): boolean {
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
  return false;
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
      if (sendGraphError(res, error)) return;
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
      if (sendGraphError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/start",
  async (req, res): Promise<void> => {
    const params = GetCodingTaskParams.safeParse(req.params);
    const body = concurrencySchema.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : body.error.message,
      });
      return;
    }

    try {
      const result = await startApprovedCodingTaskGraph(
        params.data.id,
        body.data.maxParallel,
      );
      res.status(202).json(result);
    } catch (error) {
      if (sendGraphError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/reconcile",
  async (req, res): Promise<void> => {
    const params = GetCodingTaskParams.safeParse(req.params);
    const body = concurrencySchema.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : body.error.message,
      });
      return;
    }

    try {
      const result = await reconcileCodingTaskGraph(
        params.data.id,
        body.data.maxParallel,
      );
      res.json(result);
    } catch (error) {
      if (sendGraphError(res, error)) return;
      throw error;
    }
  },
);

router.post(
  "/ai/coding/tasks/:id/task-graph/workstreams/:workstreamId/complete",
  async (req, res): Promise<void> => {
    const params = workstreamParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      await completeManualCodingWorkstream(
        params.data.id,
        params.data.workstreamId,
      );
      const result = await reconcileCodingTaskGraph(params.data.id);
      res.json(result);
    } catch (error) {
      if (sendGraphError(res, error)) return;
      throw error;
    }
  },
);

export default router;
