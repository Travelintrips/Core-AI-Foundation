import { Router } from "express";
import { enqueue } from "../services/queueManagerService.js";
import { getBlender3dStatus } from "../services/blenderLocal3dWorkerService.js";

const router = Router();

router.get("/ai/local-3d/status", async (_req, res): Promise<void> => {
  try {
    res.json(await getBlender3dStatus());
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/ai/local-3d/test-scene", async (req, res): Promise<void> => {
  const sceneType = req.body?.sceneType === "fashion" ? "fashion" : "interior";
  const width =
    typeof req.body?.width === "number" ? Math.max(256, Math.min(1024, Math.trunc(req.body.width))) : 512;
  const height =
    typeof req.body?.height === "number" ? Math.max(256, Math.min(1024, Math.trunc(req.body.height))) : 512;

  try {
    const status = await getBlender3dStatus();
    if (status["status"] !== "ok") {
      res.status(409).json({
        error: "Blender 3D worker is not ready.",
        status,
      });
      return;
    }

    const job = await enqueue({
      jobType: "blender_3d_scene",
      requiredCapability: "3d_render",
      priority: 80,
      maxRetry: 1,
      retryStrategy: "exponential",
      estimatedDuration: 180_000,
      payloadJson: {
        sceneType,
        width,
        height,
      },
    });

    res.status(202).json({
      status: "queued",
      jobId: job.id,
      jobCode: job.jobCode,
      sceneType,
      width,
      height,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
