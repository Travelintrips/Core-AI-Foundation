/**
 * creative-workflow-v2 — Workflow Definition Routes
 *
 * CRUD endpoints for WorkflowDefinitions.
 *
 * Storage: in-memory Map (no DB dependency on Team 1's side).
 * Team 24 swaps this store for a DB-backed adapter after running the
 * migration draft in integration/migrations/team-01.sql.
 *
 * All paths are relative to the router mount point (no /api prefix here).
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import type {
  WorkflowDefinition,
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
} from "../../types/creative-workflow-v2/index.js";
import { validateWorkflowDefinition } from "../../services/creative-workflow-v2/index.js";

export const definitionsRouter = Router();

// ── In-memory store (replaced by DB adapter in Team 24 integration) ───────────

const store = new Map<string, WorkflowDefinition>();

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

// ── GET /definitions ──────────────────────────────────────────────────────────

definitionsRouter.get("/", (req, res) => {
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const all = [...store.values()].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const data = all.slice(offset, offset + limit);
  res.json({ data, total: all.length, limit, offset });
});

// ── GET /definitions/:id ──────────────────────────────────────────────────────

definitionsRouter.get("/:id", (req, res) => {
  const item = store.get(req.params.id!);
  if (!item) {
    res.status(404).json({ error: "WorkflowDefinition not found" });
    return;
  }
  res.json({ data: item });
});

// ── POST /definitions ─────────────────────────────────────────────────────────

definitionsRouter.post("/", (req, res) => {
  const body = req.body as CreateWorkflowDefinitionInput;

  // Basic presence checks
  if (!body.name || !Array.isArray(body.nodes)) {
    res.status(400).json({ error: "name and nodes are required" });
    return;
  }

  const now = new Date();
  const definition: WorkflowDefinition = {
    ...body,
    id:         randomUUID(),
    version:    1,
    edges:      body.edges      ?? [],
    milestones: body.milestones ?? [],
    createdAt:  now,
    updatedAt:  now,
  };

  const errors = validateWorkflowDefinition(definition);
  if (errors.length > 0) {
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
  }

  store.set(definition.id, definition);
  res.status(201).json({ data: definition });
});

// ── PATCH /definitions/:id ────────────────────────────────────────────────────

definitionsRouter.patch("/:id", (req, res) => {
  const existing = store.get(req.params.id!);
  if (!existing) {
    res.status(404).json({ error: "WorkflowDefinition not found" });
    return;
  }

  const body = req.body as UpdateWorkflowDefinitionInput;
  const updated: WorkflowDefinition = {
    ...existing,
    ...body,
    id:        existing.id,
    version:   existing.version + 1,
    createdAt: existing.createdAt,
    updatedAt: new Date(),
  };

  const errors = validateWorkflowDefinition(updated);
  if (errors.length > 0) {
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
  }

  store.set(updated.id, updated);
  res.json({ data: updated });
});

// ── DELETE /definitions/:id ───────────────────────────────────────────────────

definitionsRouter.delete("/:id", (req, res) => {
  if (!store.has(req.params.id!)) {
    res.status(404).json({ error: "WorkflowDefinition not found" });
    return;
  }
  store.delete(req.params.id!);
  res.status(204).send();
});

// ── POST /definitions/:id/validate ───────────────────────────────────────────

definitionsRouter.post("/:id/validate", (req, res) => {
  const item = store.get(req.params.id!);
  if (!item) {
    res.status(404).json({ error: "WorkflowDefinition not found" });
    return;
  }
  const errors = validateWorkflowDefinition(item);
  res.json({ valid: errors.length === 0, errors });
});
