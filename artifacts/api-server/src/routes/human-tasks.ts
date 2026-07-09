/**
 * human-tasks.ts — Phase 6.5 Human Task Center API
 *
 * GET    /ai/human-tasks            — list (filterable, paginated)
 * GET    /ai/human-tasks/stats      — analytics stats
 * GET    /ai/human-tasks/:id        — get task + history
 * POST   /ai/human-tasks            — create task
 * PATCH  /ai/human-tasks/:id/assign    — assign
 * PATCH  /ai/human-tasks/:id/accept    — accept
 * PATCH  /ai/human-tasks/:id/reject    — reject
 * PATCH  /ai/human-tasks/:id/complete  — complete
 * PATCH  /ai/human-tasks/:id/reassign  — reassign
 */

import { Router } from "express";
import {
  CreateHumanTaskBody,
  AssignHumanTaskBody,
  AcceptHumanTaskBody,
  RejectHumanTaskBody,
  CompleteHumanTaskBody,
  ReassignHumanTaskBody,
  ListHumanTasksQueryParams,
} from "@workspace/api-zod";
import * as humanTasks from "../services/humanTaskService.js";

const router = Router();

// ── Stats (static route before :id) ───────────────────────────────────────────

router.get("/ai/human-tasks/stats", async (_req, res): Promise<void> => {
  try {
    const stats = await humanTasks.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── List ───────────────────────────────────────────────────────────────────────

router.get("/ai/human-tasks", async (req, res): Promise<void> => {
  const q = ListHumanTasksQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  try {
    // Validate date strings are parseable before passing to service
    if (q.data.dateFrom && isNaN(Date.parse(q.data.dateFrom))) {
      res.status(400).json({ error: "Invalid dateFrom: must be an ISO 8601 date string" });
      return;
    }
    if (q.data.dateTo && isNaN(Date.parse(q.data.dateTo))) {
      res.status(400).json({ error: "Invalid dateTo: must be an ISO 8601 date string" });
      return;
    }

    const result = await humanTasks.listTasks({
      status:       q.data.status       ?? undefined,
      department:   q.data.department   ?? undefined,
      priority:     q.data.priority     !== undefined ? Number(q.data.priority) : undefined,
      assignedUser: q.data.assignedUser ?? undefined,
      sourceModule: q.data.sourceModule ?? undefined,
      slaStatus:    q.data.slaStatus    ?? undefined,
      dateFrom:     q.data.dateFrom     ?? undefined,
      dateTo:       q.data.dateTo       ?? undefined,
      limit:        q.data.limit        !== undefined ? Number(q.data.limit)  : undefined,
      offset:       q.data.offset       !== undefined ? Number(q.data.offset) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Get one ────────────────────────────────────────────────────────────────────

router.get("/ai/human-tasks/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await humanTasks.getTask(id);
    res.json(result);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "NOT_FOUND") { res.status(404).json({ error: String(err) }); return; }
    res.status(500).json({ error: String(err) });
  }
});

// ── Create ─────────────────────────────────────────────────────────────────────

router.post("/ai/human-tasks", async (req, res): Promise<void> => {
  const body = CreateHumanTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const { dueAt: dueAtStr, ...rest } = body.data;
    const task = await humanTasks.createTask({
      ...rest,
      dueAt: dueAtStr ? new Date(dueAtStr) : undefined,
    });
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Assign ─────────────────────────────────────────────────────────────────────

router.patch("/ai/human-tasks/:id/assign", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = AssignHumanTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const task = await humanTasks.assignTask(id, body.data);
    res.json(task);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "NOT_FOUND")      { res.status(404).json({ error: String(err) }); return; }
    if (e.code === "TERMINAL_STATE") { res.status(409).json({ error: String(err) }); return; }
    res.status(500).json({ error: String(err) });
  }
});

// ── Accept ─────────────────────────────────────────────────────────────────────

router.patch("/ai/human-tasks/:id/accept", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = AcceptHumanTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const task = await humanTasks.acceptTask(id, body.data);
    res.json(task);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "NOT_FOUND")      { res.status(404).json({ error: String(err) }); return; }
    if (e.code === "TERMINAL_STATE") { res.status(409).json({ error: String(err) }); return; }
    res.status(500).json({ error: String(err) });
  }
});

// ── Reject ─────────────────────────────────────────────────────────────────────

router.patch("/ai/human-tasks/:id/reject", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = RejectHumanTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const task = await humanTasks.rejectTask(id, body.data);
    res.json(task);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "NOT_FOUND")      { res.status(404).json({ error: String(err) }); return; }
    if (e.code === "TERMINAL_STATE") { res.status(409).json({ error: String(err) }); return; }
    res.status(500).json({ error: String(err) });
  }
});

// ── Complete ───────────────────────────────────────────────────────────────────

router.patch("/ai/human-tasks/:id/complete", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = CompleteHumanTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const task = await humanTasks.completeTask(id, body.data);
    res.json(task);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "NOT_FOUND")      { res.status(404).json({ error: String(err) }); return; }
    if (e.code === "TERMINAL_STATE") { res.status(409).json({ error: String(err) }); return; }
    res.status(500).json({ error: String(err) });
  }
});

// ── Reassign ───────────────────────────────────────────────────────────────────

router.patch("/ai/human-tasks/:id/reassign", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = ReassignHumanTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const task = await humanTasks.reassignTask(id, body.data);
    res.json(task);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "NOT_FOUND")      { res.status(404).json({ error: String(err) }); return; }
    if (e.code === "TERMINAL_STATE") { res.status(409).json({ error: String(err) }); return; }
    res.status(500).json({ error: String(err) });
  }
});

export default router;
