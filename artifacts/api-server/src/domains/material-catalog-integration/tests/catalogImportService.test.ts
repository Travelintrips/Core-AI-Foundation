/**
 * Material Catalog Integration — Phase 3
 * Tests: Catalog Import Service + Import Report + Feature Flag + Security
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runCatalogImportPreview,
} from "../catalogImportService.js";
import {
  registerProvider,
  _resetProviderRegistry,
} from "../providerRegistry.js";
import { mockOfficialCatalogProvider } from "../providers/mockOfficialCatalogProvider.js";
import {
  setMaterialCatalogFlagOverride,
  clearMaterialCatalogFlagOverride,
  isMaterialCatalogEnabled,
} from "../featureFlag.js";
import {
  CatalogFeatureDisabledError,
  CatalogProductionImportRejectedError,
  CatalogProviderNotFoundError,
  redactProviderConfig,
} from "../errors.js";
import { buildImportReport, buildRejectedReport } from "../catalogImportReport.js";
import type { ImportOptions, ImportPreviewResult } from "../types.js";

const VALID_OPTIONS: ImportOptions = { dryRun: true };

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetProviderRegistry();
  clearMaterialCatalogFlagOverride();
});

afterEach(() => {
  _resetProviderRegistry();
  clearMaterialCatalogFlagOverride();
});

// ── Feature flag ──────────────────────────────────────────────────────────────

describe("featureFlag", () => {
  // Test 28 — feature flag defaults to disabled
  it("isMaterialCatalogEnabled defaults to false", () => {
    // No env var set, no override
    const prev = process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    clearMaterialCatalogFlagOverride();
    expect(isMaterialCatalogEnabled()).toBe(false);
    if (prev !== undefined) process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = prev;
  });

  it("isMaterialCatalogEnabled returns true when override is set", () => {
    setMaterialCatalogFlagOverride(true);
    expect(isMaterialCatalogEnabled()).toBe(true);
  });

  it("isMaterialCatalogEnabled returns false when override is false", () => {
    setMaterialCatalogFlagOverride(false);
    expect(isMaterialCatalogEnabled()).toBe(false);
  });

  it("clearMaterialCatalogFlagOverride restores env-var behaviour", () => {
    setMaterialCatalogFlagOverride(true);
    clearMaterialCatalogFlagOverride();
    const prev = process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    expect(isMaterialCatalogEnabled()).toBe(false);
    if (prev !== undefined) process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = prev;
  });
});

// ── Service: runCatalogImportPreview ──────────────────────────────────────────

describe("runCatalogImportPreview", () => {
  it("throws CatalogFeatureDisabledError when flag is false", async () => {
    setMaterialCatalogFlagOverride(false);
    registerProvider(mockOfficialCatalogProvider);
    await expect(
      runCatalogImportPreview({
        providerId: "mock-official-catalog",
        providerConfig: null,
        options: VALID_OPTIONS,
      }),
    ).rejects.toThrow(CatalogFeatureDisabledError);
  });

  it("throws CatalogProductionImportRejectedError when dryRun is false", async () => {
    setMaterialCatalogFlagOverride(true);
    registerProvider(mockOfficialCatalogProvider);
    await expect(
      runCatalogImportPreview({
        providerId: "mock-official-catalog",
        providerConfig: null,
        options: { dryRun: false } as unknown as ImportOptions,
      }),
    ).rejects.toThrow(CatalogProductionImportRejectedError);
  });

  it("throws CatalogProviderNotFoundError for unknown providerId", async () => {
    setMaterialCatalogFlagOverride(true);
    await expect(
      runCatalogImportPreview({
        providerId: "does-not-exist",
        providerConfig: null,
        options: VALID_OPTIONS,
      }),
    ).rejects.toThrow(CatalogProviderNotFoundError);
  });

  it("returns a structured report on success", async () => {
    setMaterialCatalogFlagOverride(true);
    registerProvider(mockOfficialCatalogProvider);
    const report = await runCatalogImportPreview({
      providerId: "mock-official-catalog",
      providerConfig: null,
      options: VALID_OPTIONS,
    });
    expect(report.runId).toBeTruthy();
    expect(report.providerId).toBe("mock-official-catalog");
    expect(report.startedAt).toBeInstanceOf(Date);
    expect(report.completedAt).toBeInstanceOf(Date);
    expect(["completed", "completed_with_warnings", "failed"]).toContain(report.status);
    expect(report.counts.totalReceived).toBeGreaterThan(0);
  });
});

// ── Test 24 — structured import report ───────────────────────────────────────

describe("buildImportReport", () => {
  const basePreview: ImportPreviewResult = {
    totalReceived: 10,
    validCount: 8,
    invalidCount: 2,
    newCount: 7,
    exactDuplicateCount: 1,
    possibleDuplicateCount: 0,
    warnings: ["w1"],
    errors: [],
    items: [],
    executionDurationMs: 42,
  };

  it("produces completed status when no errors or warnings", () => {
    const report = buildImportReport({
      runId: "test-run-1",
      providerId: "mock",
      startedAt: new Date(),
      completedAt: new Date(),
      previewResult: { ...basePreview, warnings: [], errors: [], invalidCount: 0 },
    });
    expect(report.status).toBe("completed");
  });

  it("produces completed_with_warnings when there are warnings", () => {
    const report = buildImportReport({
      runId: "test-run-2",
      providerId: "mock",
      startedAt: new Date(),
      completedAt: new Date(),
      previewResult: basePreview,
    });
    expect(report.status).toBe("completed_with_warnings");
  });

  it("produces failed status when there are errors", () => {
    const report = buildImportReport({
      runId: "test-run-3",
      providerId: "mock",
      startedAt: new Date(),
      completedAt: new Date(),
      previewResult: { ...basePreview, errors: ["bad thing happened"] },
    });
    expect(report.status).toBe("failed");
  });

  it("produces rejected status via buildRejectedReport", () => {
    const report = buildRejectedReport({
      runId: "test-run-4",
      providerId: "mock",
      startedAt: new Date(),
      reason: "dryRun must be true",
    });
    expect(report.status).toBe("rejected");
    expect(report.counts.totalReceived).toBe(0);
  });

  it("includes a human-readable previewSummary", () => {
    const report = buildImportReport({
      runId: "test-run-5",
      providerId: "mock",
      startedAt: new Date(),
      completedAt: new Date(),
      previewResult: basePreview,
    });
    expect(report.previewSummary).toContain("10");
    expect(report.previewSummary).toContain("7 new");
  });

  it("has all required report fields", () => {
    const report = buildImportReport({
      runId: "test-run-6",
      providerId: "mock-official-catalog",
      startedAt: new Date(),
      completedAt: new Date(),
      previewResult: basePreview,
    });
    expect(report).toHaveProperty("runId");
    expect(report).toHaveProperty("providerId");
    expect(report).toHaveProperty("startedAt");
    expect(report).toHaveProperty("completedAt");
    expect(report).toHaveProperty("status");
    expect(report).toHaveProperty("counts");
    expect(report).toHaveProperty("warnings");
    expect(report).toHaveProperty("validationErrors");
    expect(report).toHaveProperty("providerErrors");
    expect(report).toHaveProperty("previewSummary");
  });
});

// ── Test 20 — secret redaction ────────────────────────────────────────────────

describe("redactProviderConfig", () => {
  it("redacts keys matching secret/key/token/password patterns", () => {
    const config = {
      apiKey: "sk-super-secret",
      secretToken: "abc123",
      password: "hunter2",
      baseUrl: "https://api.example.com",
      timeout: 5000,
    };
    const redacted = redactProviderConfig(config) as Record<string, unknown>;
    expect(redacted["apiKey"]).toBe("[REDACTED]");
    expect(redacted["secretToken"]).toBe("[REDACTED]");
    expect(redacted["password"]).toBe("[REDACTED]");
    expect(redacted["baseUrl"]).toBe("https://api.example.com");
    expect(redacted["timeout"]).toBe(5000);
  });

  it("handles null config without throwing", () => {
    expect(redactProviderConfig(null)).toBe(null);
  });

  it("handles non-object config without throwing", () => {
    expect(redactProviderConfig("string")).toBe("string");
  });

  it("redacts credential-like keys case-insensitively", () => {
    const config = { AUTH_TOKEN: "secret", APIKEY: "secret2", normalField: "safe" };
    const redacted = redactProviderConfig(config) as Record<string, unknown>;
    expect(redacted["AUTH_TOKEN"]).toBe("[REDACTED]");
    expect(redacted["APIKEY"]).toBe("[REDACTED]");
    expect(redacted["normalField"]).toBe("safe");
  });
});

// ── Test 18 — media reference validation ─────────────────────────────────────

describe("mediaReference + URL scheme security", () => {
  it("rejects ftp:// scheme", async () => {
    const { resolveMediaReference } = await import("../catalogMediaResolver.js");
    const { CatalogUnsupportedUrlSchemeError } = await import("../errors.js");
    expect(() => resolveMediaReference("ftp://example.com/file.jpg")).toThrow(
      CatalogUnsupportedUrlSchemeError,
    );
  });

  // Test 19 — unsupported URL scheme rejection
  it("rejects http:// scheme", async () => {
    const { resolveMediaReference } = await import("../catalogMediaResolver.js");
    const { CatalogUnsupportedUrlSchemeError } = await import("../errors.js");
    expect(() => resolveMediaReference("http://example.com/img.jpg")).toThrow(
      CatalogUnsupportedUrlSchemeError,
    );
  });

  it("rejects file:// scheme", async () => {
    const { resolveMediaReference } = await import("../catalogMediaResolver.js");
    const { CatalogUnsupportedUrlSchemeError } = await import("../errors.js");
    expect(() => resolveMediaReference("file:///etc/passwd")).toThrow(
      CatalogUnsupportedUrlSchemeError,
    );
  });

  it("accepts https:// scheme", async () => {
    const { resolveMediaReference } = await import("../catalogMediaResolver.js");
    const ref = resolveMediaReference("https://example.com/img.jpg");
    expect(ref.kind).toBe("remote_url");
    expect(ref.url).toBe("https://example.com/img.jpg");
  });

  it("rejects path traversal in local_fixture", async () => {
    const { resolveMediaReference } = await import("../catalogMediaResolver.js");
    const ref = resolveMediaReference({ kind: "local_fixture", fixturePath: "../../etc/passwd" });
    expect(ref.kind).toBe("unresolved");
  });

  it("rejects absolute path in local_fixture", async () => {
    const { resolveMediaReference } = await import("../catalogMediaResolver.js");
    const ref = resolveMediaReference({ kind: "local_fixture", fixturePath: "/etc/passwd" });
    expect(ref.kind).toBe("unresolved");
  });
});

// ── Test 27 — no active production route by default ──────────────────────────

describe("Route activation", () => {
  it("feature flag defaults to false ensuring no route is active", () => {
    // This is the same as featureFlag test above — documented here for traceability
    const prev = process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    clearMaterialCatalogFlagOverride();
    expect(isMaterialCatalogEnabled()).toBe(false);
    if (prev !== undefined) process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = prev;
  });
});
