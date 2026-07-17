/**
 * universalRenderWorker.test.ts — Team 14
 *
 * Tests job routing, payload validation, and format resolution
 * for all universal_render_* job types.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RenderError } from "../../../services/universal-renderer/errors.js";
import type { AiJob } from "@workspace/db";

// ── Mock the singleton renderer (vi.hoisted required — factory is hoisted) ───

const { mockRender } = vi.hoisted(() => ({
  mockRender: vi.fn(async () => ({
    requestId:  "req-mock",
    artifacts:  [{ format: "png", storagePath: "path/img.png", publicUrl: "https://cdn/img.png", fileSizeBytes: 100, checksum: "a".repeat(64), mimeType: "image/png" }],
    warnings:   [],
    durationMs: 42,
  })),
}));

vi.mock("../../../services/universal-renderer/index.js", () => ({
  getUniversalRenderer: () => ({ render: mockRender }),
  RenderError,
}));

import { executeUniversalRenderJob, SUPPORTED_JOB_TYPES } from "../universalRenderWorker.js";

// ── Job builder helper ────────────────────────────────────────────────────────

function makeJob(jobType: string, payload: Record<string, unknown> = {}): AiJob {
  return {
    id:           1,
    jobCode:      "JC-001",
    jobType,
    status:       "running",
    payloadJson:  payload,
    resultJson:   null,
    priority:     50,
    priorityScore: "50",
    retryCount:   0,
    maxRetry:     3,
    retryStrategy: "exponential",
    errorMessage: null,
    estimatedCost: null,
    actualCost: null,
    estimatedDuration: null,
    actualDuration: null,
    managerOverride: null,
    requiredCapability: null,
    executionPlanId: null,
    departmentId: null,
    employeeId: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    nextRetryAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AiJob;
}

const VALID_SOURCE = {
  kind:         "svg",
  svgContent:   "<svg/>",
  canvasWidth:  100,
  canvasHeight: 100,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("universalRenderWorker", () => {
  beforeEach(() => {
    mockRender.mockClear();
  });

  describe("SUPPORTED_JOB_TYPES", () => {
    it("contains all expected job types", () => {
      const expected = [
        "universal_render",
        "universal_render_svg",
        "universal_render_png",
        "universal_render_pdf",
        "universal_render_thumbnail",
        "universal_render_watermarked",
        "universal_render_print_ready",
        "universal_render_zip",
        "universal_render_composition",
      ];
      for (const t of expected) {
        expect(SUPPORTED_JOB_TYPES.has(t)).toBe(true);
      }
    });
  });

  describe("executeUniversalRenderJob", () => {
    it("throws UNSUPPORTED_FORMAT for unknown job type", async () => {
      const job = makeJob("some_other_job_type");
      await expect(executeUniversalRenderJob(job)).rejects.toMatchObject({
        code: "UNSUPPORTED_FORMAT",
      });
    });

    it("throws SVG_CONTENT_MISSING when payload has no source", async () => {
      const job = makeJob("universal_render_png", {
        request: { formats: ["png"] }, // source missing
      });
      await expect(executeUniversalRenderJob(job)).rejects.toMatchObject({
        code: "SVG_CONTENT_MISSING",
      });
    });

    it("resolves formats from job-type map for universal_render_png", async () => {
      const job = makeJob("universal_render_png", {
        request: { source: VALID_SOURCE },
      });
      await executeUniversalRenderJob(job);
      expect(mockRender).toHaveBeenCalledOnce();
      const callArg = (mockRender.mock.calls as Array<Array<unknown>>)[0]![0] as { formats: string[] };
      expect(callArg.formats).toEqual(["png"]);
    });

    it("resolves formats from job-type map for universal_render_zip", async () => {
      const job = makeJob("universal_render_zip", {
        request: { source: VALID_SOURCE },
      });
      await executeUniversalRenderJob(job);
      const calls = mockRender.mock.calls as Array<Array<unknown>>;
      expect((calls[0]![0] as { formats: string[] }).formats).toContain("zip");
    });

    it("uses payload.request.formats for universal_render job type", async () => {
      const job = makeJob("universal_render", {
        request: { source: VALID_SOURCE, formats: ["svg", "pdf"] },
      });
      await executeUniversalRenderJob(job);
      const calls = mockRender.mock.calls as Array<Array<unknown>>;
      expect((calls[0]![0] as { formats: string[] }).formats).toEqual(["svg", "pdf"]);
    });

    it("throws UNSUPPORTED_FORMAT for universal_render with no formats", async () => {
      const job = makeJob("universal_render", {
        request: { source: VALID_SOURCE, formats: [] },
      });
      await expect(executeUniversalRenderJob(job)).rejects.toMatchObject({
        code: "UNSUPPORTED_FORMAT",
      });
    });

    it("stamps job-{id} as requestId", async () => {
      const job = makeJob("universal_render_svg", {
        request: { source: VALID_SOURCE },
      });
      await executeUniversalRenderJob(job);
      const calls = mockRender.mock.calls as Array<Array<unknown>>;
      expect((calls[0]![0] as { requestId: string }).requestId).toBe("job-1");
    });

    it("returns result with requestId, artifacts, warnings, durationMs", async () => {
      const job    = makeJob("universal_render_png", { request: { source: VALID_SOURCE } });
      const result = await executeUniversalRenderJob(job);
      expect(result).toMatchObject({
        requestId:  "req-mock",
        artifacts:  expect.any(Array),
        warnings:   expect.any(Array),
        durationMs: expect.any(Number),
      });
    });

    it("propagates RenderError from renderer", async () => {
      mockRender.mockRejectedValueOnce(new RenderError("STORAGE_VERIFY_FAILED", "boom"));
      const job = makeJob("universal_render_png", { request: { source: VALID_SOURCE } });
      await expect(executeUniversalRenderJob(job)).rejects.toMatchObject({
        code: "STORAGE_VERIFY_FAILED",
      });
    });
  });
});
