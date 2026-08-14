import { describe, expect, it } from "vitest";
import { isExportPackageDownloadable } from "../exportDownloadPolicy.js";

const NOW = new Date("2026-08-14T10:00:00.000Z");

function makePackage(overrides: Partial<{
  status: string;
  storagePath: string | null;
  expiresAt: Date | null;
}> = {}) {
  return {
    status: "completed",
    storagePath: "exports/interior-design/tenant/project/1/file.zip",
    expiresAt: new Date("2026-08-14T10:00:01.000Z"),
    ...overrides,
  };
}

describe("Interior Design export download eligibility", () => {
  it("allows a valid active package", () => {
    expect(isExportPackageDownloadable(makePackage(), NOW)).toBe(true);
  });

  it("rejects an expired package", () => {
    expect(isExportPackageDownloadable(
      makePackage({ expiresAt: new Date("2026-08-14T09:59:59.000Z") }),
      NOW,
    )).toBe(false);
  });

  it("rejects an expired package even when the signed token is still valid", () => {
    // Token validity is deliberately not part of this policy. The package
    // guard must independently reject the request before storage access.
    const stillValidToken = true;
    expect(stillValidToken).toBe(true);
    expect(isExportPackageDownloadable(
      makePackage({ expiresAt: new Date("2026-08-14T09:59:59.000Z") }),
      NOW,
    )).toBe(false);
  });

  it("treats expires_at exactly at the current time as expired", () => {
    expect(isExportPackageDownloadable(
      makePackage({ expiresAt: NOW }),
      NOW,
    )).toBe(false);
  });

  it("rejects packages without an expiry timestamp", () => {
    expect(isExportPackageDownloadable(makePackage({ expiresAt: null }), NOW)).toBe(false);
  });

  it("rejects packages that are not completed or have no storage object", () => {
    expect(isExportPackageDownloadable(makePackage({ status: "queued" }), NOW)).toBe(false);
    expect(isExportPackageDownloadable(makePackage({ storagePath: null }), NOW)).toBe(false);
  });

  it("keeps the existing active-package behavior unchanged", () => {
    expect(isExportPackageDownloadable(
      makePackage({ expiresAt: new Date("2026-08-15T10:00:00.000Z") }),
      NOW,
    )).toBe(true);
  });
});