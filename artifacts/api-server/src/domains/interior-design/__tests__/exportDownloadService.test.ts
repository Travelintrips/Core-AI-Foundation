import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
  getSupabasePublicUrl: vi.fn(() => "https://storage.example/export.zip"),
  uploadToSupabase: vi.fn(),
  generateDownloadToken: vi.fn(() => "generated-token"),
  verifyDownloadToken: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mocks.db,
  aiEntityVersionsTable: {},
  aiJobsTable: {},
  creativeProjectsTable: {},
}));

vi.mock("../../../lib/supabaseStorage.js", () => ({
  getSupabasePublicUrl: mocks.getSupabasePublicUrl,
  uploadToSupabase: mocks.uploadToSupabase,
}));

vi.mock("../../../services/signedUrlService.js", () => ({
  generateDownloadToken: mocks.generateDownloadToken,
  verifyDownloadToken: mocks.verifyDownloadToken,
}));

vi.mock("../../../services/aiAuditService.js", () => ({
  logAudit: mocks.logAudit,
}));

import { resolveDownloadRedirect } from "../exportService.js";

const NOW = new Date("2026-08-14T10:00:00.000Z");

function queryReturning<T>(rows: T[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    tenantId: "tenant-1",
    projectUuid: "project-uuid",
    status: "completed",
    storagePath: "exports/interior-design/tenant-1/project-uuid/7/file.zip",
    expiresAt: new Date("2026-08-14T10:00:01.000Z"),
    ...overrides,
  };
}

describe("resolveDownloadRedirect package guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("rejects an expired package before storage URL resolution", async () => {
    mocks.db.select.mockReturnValue(queryReturning([
      makePackage({ expiresAt: new Date("2026-08-14T09:59:59.000Z") }),
    ]));
    mocks.verifyDownloadToken.mockReturnValue({
      valid: true,
      payload: { pid: 42, url: "https://storage.example/export.zip" },
    });

    await expect(resolveDownloadRedirect(7, "still-valid-token")).resolves.toBeNull();
    expect(mocks.getSupabasePublicUrl).not.toHaveBeenCalled();
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it("rejects a package at the exact expiry boundary", async () => {
    mocks.db.select.mockReturnValue(queryReturning([
      makePackage({ expiresAt: NOW }),
    ]));

    await expect(resolveDownloadRedirect(7, "still-valid-token")).resolves.toBeNull();
    expect(mocks.getSupabasePublicUrl).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens before resolving project or storage URL", async () => {
    mocks.db.select.mockReturnValue(queryReturning([makePackage()]));
    mocks.verifyDownloadToken.mockReturnValue({ valid: false, reason: "Invalid signature" });

    await expect(resolveDownloadRedirect(7, "invalid-token")).resolves.toBeNull();
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    expect(mocks.getSupabasePublicUrl).not.toHaveBeenCalled();
  });

  it("preserves active-package download behavior", async () => {
    mocks.db.select
      .mockReturnValueOnce(queryReturning([makePackage()]))
      .mockReturnValueOnce(queryReturning([{ id: 42 }]));
    mocks.verifyDownloadToken.mockReturnValue({
      valid: true,
      payload: { pid: 42, url: "https://storage.example/export.zip" },
    });

    await expect(resolveDownloadRedirect(7, "valid-token"))
      .resolves.toBe("https://storage.example/export.zip");
    expect(mocks.getSupabasePublicUrl).toHaveBeenCalledWith(
      "exports/interior-design/tenant-1/project-uuid/7/file.zip",
    );
  });
});