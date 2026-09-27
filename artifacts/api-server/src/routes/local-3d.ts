import { Router } from "express";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { aiJobsTable, db } from "@workspace/db";
import { enqueue } from "../services/queueManagerService.js";
import {
  getBlender3dStatus,
  readBlender3dConfig,
} from "../services/blenderLocal3dWorkerService.js";

const router = Router();

const ARTIFACT_FILES = {
  glb: "scene.glb",
  preview: "preview.png",
  blend: "scene.blend",
} as const;

type ArtifactKind = keyof typeof ARTIFACT_FILES;

function parseJobId(raw: string | undefined): number | null {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function artifactUrls(jobId: number) {
  return {
    glbUrl: `/api/ai/local-3d/jobs/${jobId}/artifacts/glb`,
    previewUrl: `/api/ai/local-3d/jobs/${jobId}/artifacts/preview`,
    blendUrl: `/api/ai/local-3d/jobs/${jobId}/artifacts/blend`,
  };
}

async function get3dJob(jobId: number) {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.jobType, "blender_3d_scene")))
    .limit(1);
  return job ?? null;
}

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
      pollUrl: `/api/ai/local-3d/jobs/${job.id}`,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get("/ai/local-3d/jobs/:jobId", async (req, res): Promise<void> => {
  const jobId = parseJobId(req.params["jobId"]);
  if (!jobId) {
    res.status(400).json({ error: "Invalid 3D job id." });
    return;
  }

  try {
    const job = await get3dJob(jobId);
    if (!job) {
      res.status(404).json({ error: "3D job not found." });
      return;
    }

    const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
    res.json({
      jobId: job.id,
      jobCode: job.jobCode,
      status: job.status,
      sceneType: payload["sceneType"] === "fashion" ? "fashion" : "interior",
      error: job.errorMessage ?? null,
      assets: job.status === "completed" ? artifactUrls(job.id) : null,
      completedAt: job.completedAt ?? null,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get("/ai/local-3d/jobs/:jobId/artifacts/:kind", async (req, res): Promise<void> => {
  const jobId = parseJobId(req.params["jobId"]);
  const kind = req.params["kind"] as ArtifactKind | undefined;
  if (!jobId || !kind || !(kind in ARTIFACT_FILES)) {
    res.status(400).json({ error: "Invalid 3D artifact request." });
    return;
  }

  try {
    const job = await get3dJob(jobId);
    if (!job) {
      res.status(404).json({ error: "3D job not found." });
      return;
    }
    if (job.status !== "completed") {
      res.status(409).json({ error: `3D job is ${job.status}; artifact is not ready.` });
      return;
    }

    const config = readBlender3dConfig();
    const jobDir = path.join(config.outputDir, `job-${jobId}`);
    const fileName = ARTIFACT_FILES[kind];

    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(fileName, { root: jobDir }, (error) => {
      if (!error || res.headersSent) return;
      res.status(404).json({ error: "3D artifact file not found." });
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
