import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyDownloadToken = vi.hoisted(() => vi.fn());
const mockGenerateDownloadToken = vi.hoisted(() => vi.fn(() => "generated-token"));
const mockRevokeToken = vi.hoisted(() => vi.fn());
const mockLogAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSelectLimit = vi.hoisted(() => vi.fn());

const selectBuilder = {
  from: vi.fn(() => selectBuilder),
  where: vi.fn(() => selectBuilder),
  limit: mockSelectLimit,
};

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => selectBuilder),
  },
  creativeProjectsTable: {
    id: "projects.id",
    filesUnlocked: "projects.filesUnlocked",
    status: "projects.status",
  },
}));

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: mockLogAudit,
}));

vi.mock("../../services/signedUrlService.js", () => ({
  generateDownloadToken: mockGenerateDownloadToken,
  verifyDownloadToken: mockVerifyDownloadToken,
  revokeToken: mockRevokeToken,
}));

vi.mock("../../middleware/rateLimiter.js", () => ({
  uploadLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { default: filesRouter } = await import("../files.js");

const originalEnv = {
  nodeEnv: process.env["NODE_ENV"],
  publicAppUrl: process.env["PUBLIC_APP_URL"],
};

const app = express();
app.use(express.json());
app.use(filesRouter);

describe("file access redirect security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["NODE_ENV"] = "production";
    process.env["PUBLIC_APP_URL"] = "https://trusted.example.test";
    mockVerifyDownloadToken.mockReturnValue({
      valid: true,
      payload: {
        id: "token-1",
        pid: 42,
        url: "/storage/report.pdf",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    mockSelectLimit.mockResolvedValue([
      { id: 42, filesUnlocked: true, status: "completed" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv.nodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = originalEnv.nodeEnv;
    if (originalEnv.publicAppUrl === undefined) delete process.env["PUBLIC_APP_URL"];
    else process.env["PUBLIC_APP_URL"] = originalEnv.publicAppUrl;
  });

  it("redirects to a valid internal path", async () => {
    const response = await request(app).get("/public/files/access/token");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/storage/report.pdf");
    expect(fetch).toHaveBeenCalledWith("/storage/report.pdf", { method: "HEAD" });
  });

  it("redirects to an exact trusted destination when required", async () => {
    mockVerifyDownloadToken.mockReturnValueOnce({
      valid: true,
      payload: {
        id: "token-2",
        pid: 42,
        url: "https://trusted.example.test/storage/report.pdf",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const response = await request(app).get("/public/files/access/token");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://trusted.example.test/storage/report.pdf");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/%2f%2fevil.example",
    "https:%2f%2fevil.example",
  ])("rejects unsafe redirect target %s", async (url) => {
    mockVerifyDownloadToken.mockReturnValueOnce({
      valid: true,
      payload: {
        id: "unsafe-token",
        pid: 42,
        url,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const response = await request(app).get("/public/files/access/token");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REDIRECT_TARGET");
    expect(response.headers.location).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not issue a token for an untrusted file URL", async () => {
    const response = await request(app)
      .post("/ai/files/generate-token")
      .send({ projectId: 42, fileUrl: "https://evil.example/file.pdf" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REDIRECT_TARGET");
    expect(mockSelectLimit).not.toHaveBeenCalled();
    expect(mockGenerateDownloadToken).not.toHaveBeenCalled();
  });
});