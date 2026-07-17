/**
 * creative-workflow-v2 — Execution Plan Routes
 *
 * Build, inspect, and control ExecutionPlans.
 *
 * Storage: in-memory Map (Team 24 replaces with DB adapter after migration).
 *
 * All paths are relative to the router mount point (no /api prefix here).
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { Router } from "express";
import type { ExecutionPlan } from "../../types/creative-workflow-v2/index.js";
import {
  buildExecutionPlan,
  startPlan,
  pausePlan,
  resumePlan,
  cancelPlan,
  markNodeCompleted,
  markNodeRunning,
  markNodeSkipped,
  markNodeReady,
  calculateProgress,
} from "../../services/creative-workflow-v2/index.js";

// In-memory store for definitions — shared reference with definitions.ts
// via the module that mounts both routers. Team 24 replaces with a repository.
import type { WorkflowDefinition } from "../../types/creative-workflow-v2/index.js";

export const plansRouter = Router();

// ── In-memory stores ──────────────────────────────────────────────────────────

const planStore  = new Map<string, ExecutionPlan>();

// Definitions injected from the outside (Team 24 adapter) — fallback to local.
let _definitionResolver: (id: string) => WorkflowDefinition | undefined = () =>
  undefined;

/**
 * Inject a definition resolver (DB-backed or in-memory).
 * Called by Team 24 during integration wiring.
 */
export function setDefinitionResolver(
  fn: (id: string) => WorkflowDefinition | undefined,
): void {
  _definitionResolver = fn;
}

// ── Pagination constants ───────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 200;

function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const rawLimit  = parseInt(String(query.limit  ?? DEFAULT_LIMIT), 10);
  const rawOffset = parseInt(String(query.offset ?? 0),             10);
  const limit  = Math.min(Math.max(Number.isFinite(rawLimit)  ? rawLimit  : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);
  return { limit, offset };
}

// ── GET /plans ────────────────────────────────────────────────────────────────

plansRouter.get("/", (req, res) => {
  let filtered = [...planStore.values()];

  // Optional filters
  const { contextId, contextType, status } = req.query as Record<string, string>;
  if (contextId)   filtered = filtered.filter((p) => p.contextId === contextId);
  if (contextType) filtered = filtered.filter((p) => p.contextType === contextType);
  if (status)      filtered = filtered.filter((p) => p.status === status);

  filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const data = filtered.slice(offset, offset + limit);
  res.json({ data, total: filtered.length, limit, offset });
});

// ── GET /plans/:id ────────────────────────────────────────────────────────────

plansRouter.get("/:id", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) {
    res.status(404).json({ error: "ExecutionPlan not found" });
    return;
  }
  res.json({ data: plan });
});

// ── GET /plans/:id/progress ───────────────────────────────────────────────────

plansRouter.get("/:id/progress", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) {
    res.status(404).json({ error: "ExecutionPlan not found" });
    return;
  }
  res.json({ data: calculateProgress(plan.nodes) });
});

// ── POST /plans — build a new plan ───────────────────────────────────────────

plansRouter.post("/", (req, res) => {
  const { workflowDefinitionId, contextId, contextType, metadata } =
    req.body as {
      workflowDefinitionId: string;
      contextId: string;
      contextType: string;
      metadata?: Record<string, unknown>;
    };

  if (!workflowDefinitionId || !contextId || !contextType) {
    res
      .status(400)
      .json({ error: "workflowDefinitionId, contextId, and contextType are required" });
    return;
  }

  const definition = _definitionResolver(workflowDefinitionId);
  if (!definition) {
    res
      .status(404)
      .json({ error: `WorkflowDefinition "${workflowDefinitionId}" not found` });
    return;
  }

  try {
    const plan = buildExecutionPlan(definition, { contextId, contextType, metadata });
    planStore.set(plan.id, plan);
    res.status(201).json({ data: plan });
  } catch (err) {
    res
      .status(422)
      .json({ error: err instanceof Error ? err.message : "Plan build failed" });
  }
});

// ── POST /plans/:id/start ─────────────────────────────────────────────────────

plansRouter.post("/:id/start", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  try {
    const updated = startPlan(plan);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});

// ── POST /plans/:id/pause ─────────────────────────────────────────────────────

plansRouter.post("/:id/pause", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  try {
    const updated = pausePlan(plan, req.body?.reason as string | undefined);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});

// ── POST /plans/:id/resume ────────────────────────────────────────────────────

plansRouter.post("/:id/resume", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  try {
    const updated = resumePlan(plan);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});

// ── POST /plans/:id/cancel ────────────────────────────────────────────────────

plansRouter.post("/:id/cancel", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  try {
    const updated = cancelPlan(plan, req.body?.reason as string | undefined);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});

// ── POST /plans/:id/nodes/:nodeId/running ─────────────────────────────────────

plansRouter.post("/:id/nodes/:nodeId/running", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  const { jobId } = req.body as { jobId: string };
  if (!jobId) { res.status(400).json({ error: "jobId is required" }); return; }
  try {
    const updated = markNodeRunning(plan, req.params.nodeId!, jobId);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});

// ── POST /plans/:id/nodes/:nodeId/completed ───────────────────────────────────

plansRouter.post("/:id/nodes/:nodeId/completed", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  try {
    const updated = markNodeCompleted(plan, req.params.nodeId!, req.body?.result);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});

// ── POST /plans/:id/nodes/:nodeId/skipped ─────────────────────────────────────

plansRouter.post("/:id/nodes/:nodeId/skipped", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  try {
    const updated = markNodeSkipped(plan, req.params.nodeId!);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});

// ── POST /plans/:id/nodes/:nodeId/ready ───────────────────────────────────────

plansRouter.post("/:id/nodes/:nodeId/ready", (req, res) => {
  const plan = planStore.get(req.params.id!);
  if (!plan) { res.status(404).json({ error: "ExecutionPlan not found" }); return; }
  try {
    const updated = markNodeReady(plan, req.params.nodeId!);
    planStore.set(updated.id, updated);
    res.json({ data: updated });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Conflict" });
  }
});
