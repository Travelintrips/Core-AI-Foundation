import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  getBlender3dStatus: vi.fn(),
  readBlender3dConfig: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  aiJobsTable: {
    id: "id",
    jobType: "job_type",
  },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.selectLimit,
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}));

vi.mock("../../services/queueManagerService.js", () => ({
  enqueue: mocks.enqueue,
}));

vi.mock("../../services/blenderLocal3dWorkerService.js", () => ({
  getBlender3dStatus: mocks.getBlender3dStatus,
  readBlender3dConfig: mocks.readBlender3dConfig,
}));

import local3dRouter from "../local-3d.js";

const app = express();
app.use(express.json());
app.use(local3dRouter);

describe("local 3D route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlender3dStatus.mockResolvedValue({
      enabled: true,
      status: "ok",
      capabilities: ["3d_render", "3d_export_glb"],
    });
    mocks.enqueue.mockResolvedValue({
      id: 42,
      jobCode: "JOB-3D-42",
    });
  });

  it("reports Blender runtime status", async () => {
    const res = await request(app).get("/ai/local-3d/status");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      status: "ok",
    });
  });

  it("queues an interior job and exposes a polling URL", async () => {
    const res = await request(app)
      .post("/ai/local-3d/test-scene")
      .send({ sceneType: "interior", width: 768, height: 768 });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: "queued",
      jobId: 42,
      jobCode: "JOB-3D-42",
      sceneType: "interior",
      width: 768,
      height: 768,
      pollUrl: "/api/ai/local-3d/jobs/42",
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "blender_3d_scene",
      requiredCapability: "3d_render",
      payloadJson: expect.objectContaining({
        sceneType: "interior",
        width: 768,
        height: 768,
      }),
    }));
  });

  it("rejects queueing while Blender is unavailable", async () => {
    mocks.getBlender3dStatus.mockResolvedValueOnce({
      enabled: true,
      status: "fail",
      error: "Blender executable not found",
    });

    const res = await request(app)
      .post("/ai/local-3d/test-scene")
      .send({ sceneType: "fashion" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("not ready");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("returns completed job with authenticated artifact URLs", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 42,
      jobCode: "JOB-3D-42",
      jobType: "blender_3d_scene",
      status: "completed",
      payloadJson: { sceneType: "fashion" },
      resultJson: {},
      errorMessage: null,
      completedAt: new Date("2026-09-28T00:00:00Z"),
    }]);

    const res = await request(app).get("/ai/local-3d/jobs/42");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      jobId: 42,
      status: "completed",
      sceneType: "fashion",
      assets: {
        glbUrl: "/api/ai/local-3d/jobs/42/artifacts/glb",
        previewUrl: "/api/ai/local-3d/jobs/42/artifacts/preview",
        blendUrl: "/api/ai/local-3d/jobs/42/artifacts/blend",
      },
    });
  });

  it("does not expose artifact URLs before completion", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 42,
      jobCode: "JOB-3D-42",
      jobType: "blender_3d_scene",
      status: "running",
      payloadJson: { sceneType: "interior" },
      resultJson: null,
      errorMessage: null,
      completedAt: null,
    }]);

    const res = await request(app).get("/ai/local-3d/jobs/42");

    expect(res.status).toBe(200);
    expect(res.body.assets).toBeNull();
  });

  it("serves the generated GLB only for a completed 3D job", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "core-ai-3d-"));
    const jobDir = path.join(root, "job-42");
    await mkdir(jobDir, { recursive: true });
    await writeFile(path.join(jobDir, "scene.glb"), Buffer.from("glTF-test"));

    mocks.readBlender3dConfig.mockReturnValue({
      enabled: true,
      executablePath: "blender",
      outputDir: root,
      scriptPath: "worker.py",
    });
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 42,
      jobCode: "JOB-3D-42",
      jobType: "blender_3d_scene",
      status: "completed",
      payloadJson: { sceneType: "interior" },
      resultJson: {},
      errorMessage: null,
      completedAt: new Date(),
    }]);

    const res = await request(app).get("/ai/local-3d/jobs/42/artifacts/glb");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("private");
    expect(Buffer.from(res.body).toString()).toBe("glTF-test");
  });

  it("blocks artifact download while job is still running", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 42,
      jobCode: "JOB-3D-42",
      jobType: "blender_3d_scene",
      status: "running",
      payloadJson: {},
      resultJson: null,
      errorMessage: null,
      completedAt: null,
    }]);

    const res = await request(app).get("/ai/local-3d/jobs/42/artifacts/glb");

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("not ready");
  });

  it("rejects unknown artifact kinds", async () => {
    const res = await request(app).get("/ai/local-3d/jobs/42/artifacts/exe");
    expect(res.status).toBe(400);
  });
});
