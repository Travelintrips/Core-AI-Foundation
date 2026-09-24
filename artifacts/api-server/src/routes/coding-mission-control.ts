import { Router } from "express";
import { GetCodingTaskParams } from "@workspace/api-zod";
import { getCodingMissionControlSnapshot } from "../services/localCodingMissionControlService.js";

const router = Router();

router.get(
  "/ai/coding/tasks/:id/mission-control",
  async (req, res): Promise<void> => {
    const params = GetCodingTaskParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const snapshot = await getCodingMissionControlSnapshot(params.data.id);
    if (!snapshot) {
      res.status(404).json({ error: "Coding mission control graph not found" });
      return;
    }

    res.json(snapshot);
  },
);

export default router;
