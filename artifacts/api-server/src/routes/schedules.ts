/**
 * schedules.ts — AI Scheduler & Automation Engine (Phase 6)
 *
 * GET    /ai/schedules              — list schedules
 * POST   /ai/schedules              — create schedule
 * GET    /ai/schedules/:id          — get schedule
 * PATCH  /ai/schedules/:id          — update schedule
 * POST   /ai/schedules/:id/pause    — pause schedule
 * POST   /ai/schedules/:id/resume   — resume schedule
 * POST   /ai/schedules/:id/cancel   — cancel schedule
 * POST   /ai/schedules/:id/run-now  — execute schedule immediately
 * GET    /ai/schedules/:id/runs     — list runs for a schedule
 *
 * GET    /ai/schedule-runs          — list runs across all schedules
 *
 * GET    /ai/scheduler/status       — runtime status snapshot
 * POST   /ai/scheduler/start        — start background poller
 * POST   /ai/scheduler/stop         — stop background poller
 * POST   /ai/scheduler/tick         — run one poll cycle immediately
 * GET    /ai/scheduler/settings     — current scheduler settings
 * PATCH  /ai/scheduler/settings     — update scheduler settings
 */

import { Router } from "express";
import {
  CreateScheduleBody,
  UpdateScheduleBody,
  ListSchedulesQueryParams,
  ListScheduleRunsQueryParams,
  UpdateSchedulerSettingsBody,
} from "@workspace/api-zod";
import * as scheduler from "../services/aiSchedulerService.js";

const router = Router();

// ── Scheduler runtime (must be declared before /ai/schedules/:id to avoid
//    "scheduler" being captured as an :id-like static segment; distinct base path
//    so no ordering issue, but kept together for readability) ──────────────────

router.get("/ai/scheduler/status", async (_req, res): Promise<void> => {
  const status = await scheduler.getStatus();
  res.json(status);
});

router.post("/ai/scheduler/start", async (_req, res): Promise<void> => {
  await scheduler.start();
  const status = await scheduler.getStatus();
  res.json(status);
});

router.post("/ai/scheduler/stop", async (_req, res): Promise<void> => {
  await scheduler.stop();
  const status = await scheduler.getStatus();
  res.json(status);
});

router.post("/ai/scheduler/tick", async (_req, res): Promise<void> => {
  const tickResult = await scheduler.tick();
  const status = await scheduler.getStatus();
  res.json({ ...status, tick: tickResult });
});

router.get("/ai/scheduler/settings", (_req, res): void => {
  res.json(scheduler.getSettings());
});

router.patch("/ai/scheduler/settings", (req, res): void => {
  const body = UpdateSchedulerSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const settings = scheduler.updateSettings(body.data);
  res.json(settings);
});

// ── Schedule runs (cross-schedule) ─────────────────────────────────────────────

router.get("/ai/schedule-runs", async (req, res): Promise<void> => {
  const q = ListScheduleRunsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  try {
    const result = await scheduler.listScheduleRuns(q.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Schedules ──────────────────────────────────────────────────────────────────

router.get("/ai/schedules", async (req, res): Promise<void> => {
  const q = ListSchedulesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  try {
    const result = await scheduler.listSchedules(q.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/ai/schedules", async (req, res): Promise<void> => {
  const body = CreateScheduleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const { runAt, ...rest } = body.data;
    const schedule = await scheduler.createSchedule({
      ...rest,
      runAt: runAt ? new Date(runAt) : null,
    });
    res.status(201).json(schedule);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/ai/schedules/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  try {
    const schedule = await scheduler.getSchedule(id);
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.patch("/ai/schedules/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  const body = UpdateScheduleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const { runAt, ...rest } = body.data;
    const schedule = await scheduler.updateSchedule(id, {
      ...rest,
      ...(runAt !== undefined ? { runAt: new Date(runAt) } : {}),
    });
    res.json(schedule);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

router.post("/ai/schedules/:id/pause", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  try {
    const schedule = await scheduler.pauseSchedule(id);
    res.json(schedule);
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
  }
});

router.post("/ai/schedules/:id/resume", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  try {
    const schedule = await scheduler.resumeSchedule(id);
    res.json(schedule);
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
  }
});

router.post("/ai/schedules/:id/cancel", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  try {
    const schedule = await scheduler.cancelSchedule(id);
    res.json(schedule);
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
  }
});

router.post("/ai/schedules/:id/run-now", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  try {
    const schedule = await scheduler.runNow(id);
    res.json(schedule);
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
  }
});

router.get("/ai/schedules/:id/runs", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid schedule id" });
    return;
  }
  const q = ListScheduleRunsQueryParams.safeParse({ ...req.query, scheduleId: id });
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  try {
    const result = await scheduler.listScheduleRuns(q.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
