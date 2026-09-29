import { Router } from "express";
import { z } from "zod";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { renewCodingBridgePresence } from "../services/localCodingControlBridgeService.js";
import {
  TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID,
  getAutonomousCodingTaskStatus,
  listActiveAutonomousCodingTasks,
  runAutonomousCodingCycle,
} from "../services/localCodingAutonomousRepairService.js";

const router = Router();
const Uuid = z.string().uuid();

router.get(
  "/ai/temporal-coding/health",
  requireAgentServiceScope("coding:orchestrate"),
  (_req, res) => {
    res.json({
      status: "ok",
      service: "ai-core-temporal-coding",
      clientId: TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID,
    });
  },
);

router.post(
  "/ai/temporal-coding/presence/heartbeat",
  requireAgentServiceScope("coding:orchestrate"),
  async (req, res): Promise<void> => {
    const body = z.object({
      leaseSeconds: z.number().int().min(30).max(300).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).strict().safeParse(req.body ?? {});

    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const presence = await renewCodingBridgePresence({
      clientId: TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID,
      source: "temporal",
      leaseSeconds: body.data.leaseSeconds ?? 90,
      metadata: body.data.metadata ?? {},
    });

    res.json({
      ok: true,
      clientId: presence.clientId,
      leaseExpiresAt: presence.leaseExpiresAt,
      lastSeenAt: presence.lastSeenAt,
    });
  },
);

router.get(
  "/ai/temporal-coding/tasks",
  requireAgentServiceScope("coding:orchestrate"),
  async (req, res): Promise<void> => {
    const parsed = z.coerce.number().int().min(1).max(50).optional().safeParse(req.query["limit"]);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const tasks = await listActiveAutonomousCodingTasks(parsed.data ?? 8);
    res.json({ tasks, total: tasks.length });
  },
);

router.get(
  "/ai/temporal-coding/tasks/:id",
  requireAgentServiceScope("coding:orchestrate"),
  async (req, res): Promise<void> => {
    const id = Uuid.safeParse(req.params["id"]);
    if (!id.success) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }

    const state = await getAutonomousCodingTaskStatus(id.data);
    if (!state) {
      res.status(404).json({ error: "Autonomous task state not found" });
      return;
    }
    res.json(state);
  },
);

router.post(
  "/ai/temporal-coding/tasks/:id/run-once",
  requireAgentServiceScope("coding:orchestrate"),
  async (req, res): Promise<void> => {
    const id = Uuid.safeParse(req.params["id"]);
    if (!id.success) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }

    const result = await runAutonomousCodingCycle(id.data);
    res.json(result);
  },
);

export default router;
