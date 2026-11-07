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

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireInternalRole, requirePasswordChanged } from "../middleware/internalAuth.js";
import { ssrfGuard } from "../middleware/ssrfGuard.js";
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

// Fail-closed for AI Core lifecycle reviews only. Never infer a reviewer from
// performedBy in the request body or from the legacy admin API-key bypass.
const humanLifecycleRoles = requireInternalRole("owner", "admin");
async function guardLifecycleReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = Number(req.params["id"]);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({error:"INVALID_HUMAN_TASK_ID"}); return; }
  try {
    const {task} = await humanTasks.getTask(id);
    if (task.sourceModule !== "ai_core_lifecycle") {next(); return;}
    if (process.env.NODE_ENV !== "development" || process.env.APP_ENV === "production") {
      res.status(403).json({error:"DEV_LIFECYCLE_REVIEW_ONLY"});return;
    }
    await requireAuth(req,res,()=>{
      void humanLifecycleRoles(req,res,()=>{
        requirePasswordChanged(req,res,()=>{
          const actor=req.internalUser;
          if (!actor) {res.status(401).json({error:"SESSION_REQUIRED"});return;}
          const assigned=(task.assignedUser??"").trim().toLowerCase();
          if (req.method !== "GET" && (!assigned || assigned!==actor.email.trim().toLowerCase())) {
            res.status(403).json({error:"ASSIGNED_HUMAN_REVIEWER_REQUIRED"});return;
          }
          if (req.method !== "GET") {
            // Browser mutation must originate from the same authenticated portal.
            const origin=req.get("origin");
            if (!origin) {res.status(403).json({error:"LIFECYCLE_REVIEW_ORIGIN_REQUIRED"});return;}
            try { if(new URL(origin).host!==req.get("host")) {res.status(403).json({error:"LIFECYCLE_REVIEW_CROSS_ORIGIN"});return;} }
            catch {res.status(403).json({error:"LIFECYCLE_REVIEW_CROSS_ORIGIN"});return;}
            const body=req.body && typeof req.body==="object" && !Array.isArray(req.body) ? req.body as Record<string,unknown> : {};
            // Ignore client-provided identity even if submitted by a matching actor.
            req.body={...body,performedBy:actor.email};
          }
          next();
        });
      });
    });
  } catch(error){
    const code=(error as {code?:string})?.code;
    if(code==="NOT_FOUND") {res.sendStatus(404);return;}
    res.status(503).json({error:"HUMAN_LIFECYCLE_REVIEW_AUTH_UNAVAILABLE"});
  }
}
router.use("/ai/human-tasks/:id", guardLifecycleReview);


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

router.post("/ai/human-tasks", ssrfGuard(["notificationHookUrl", "webhookUrl"]), async (req, res): Promise<void> => {
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
