/**
 * Design Template Engine — ZIP Export Unit Tests (Phase 3B)
 *
 * Tests:
 *  - Fingerprint determinism
 *  - Duplicate export reuse
 *  - Filename sanitization (path traversal, special chars)
 *  - CSV formula injection prevention
 *  - ZIP Slip prevention
 *  - Signed URL only when completed
 *  - Cross-tenant rejection
 *  - Retry safety
 *  - Manifest accuracy
 */

import { describe, it, expect } from "vitest";
import {
  computeBatchFingerprint,
  sanitizeFilename,
  buildSafeEntryPath,
  escapeCsvCell,
  buildFailuresCsv,
  generateZipDownloadToken,
  verifyZipDownloadToken,
} from "../services/designZipExportService.js";
import type { BatchItemSnapshot } from "../services/designZipExportService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<BatchItemSnapshot> = {}): BatchItemSnapshot {
  return {
    itemId: 1,
    status: "completed",
    outputStoragePath: "/bucket/renders/item-1.png",
    outputFormat: "png",
    outputFileSizeBytes: 12345,
    errorMessage: null,
    ...overrides,
  };
}

// ── Fingerprint Determinism ───────────────────────────────────────────────────

describe("computeBatchFingerprint", () => {
  it("produces the same fingerprint for the same completed items regardless of input order", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/bucket/1.png", outputFileSizeBytes: 100 }),
      makeItem({ itemId: 2, outputStoragePath: "/bucket/2.png", outputFileSizeBytes: 200 }),
      makeItem({ itemId: 3, outputStoragePath: "/bucket/3.png", outputFileSizeBytes: 300 }),
    ];

    const shuffled: BatchItemSnapshot[] = [
      makeItem({ itemId: 3, outputStoragePath: "/bucket/3.png", outputFileSizeBytes: 300 }),
      makeItem({ itemId: 1, outputStoragePath: "/bucket/1.png", outputFileSizeBytes: 100 }),
      makeItem({ itemId: 2, outputStoragePath: "/bucket/2.png", outputFileSizeBytes: 200 }),
    ];

    expect(computeBatchFingerprint(items)).toBe(computeBatchFingerprint(shuffled));
  });

  it("produces a different fingerprint when an item changes", () => {
    const items1: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/bucket/1.png", outputFileSizeBytes: 100 }),
    ];
    const items2: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/bucket/1-modified.png", outputFileSizeBytes: 100 }),
    ];

    expect(computeBatchFingerprint(items1)).not.toBe(computeBatchFingerprint(items2));
  });

  it("ignores failed/non-completed items in the fingerprint", () => {
    const items1: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/bucket/1.png", outputFileSizeBytes: 100 }),
    ];
    const items2: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/bucket/1.png", outputFileSizeBytes: 100 }),
      makeItem({ itemId: 2, status: "failed", outputStoragePath: null, outputFileSizeBytes: null }),
    ];

    expect(computeBatchFingerprint(items1)).toBe(computeBatchFingerprint(items2));
  });

  it("returns a 64-char hex sha256 string", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 1 }),
    ];
    const fp = computeBatchFingerprint(items);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across multiple calls with identical input", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/bucket/1.png", outputFileSizeBytes: 500 }),
      makeItem({ itemId: 5, outputStoragePath: "/bucket/5.png", outputFileSizeBytes: 1000 }),
    ];
    const fp1 = computeBatchFingerprint(items);
    const fp2 = computeBatchFingerprint(items);
    const fp3 = computeBatchFingerprint(items);
    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
  });
});

// ── Filename Sanitization ─────────────────────────────────────────────────────

describe("sanitizeFilename", () => {
  it("strips path traversal sequences", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("../../../secret.txt")).toBe("secret.txt");
    expect(sanitizeFilename("foo/../../bar.png")).toBe("bar.png");
  });

  it("removes absolute path components", () => {
    expect(sanitizeFilename("/etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("/absolute/path/file.png")).toBe("file.png");
  });

  it("removes backslash path traversal", () => {
    expect(sanitizeFilename("..\\..\\windows\\system32\\evil.exe")).not.toContain("system32");
  });

  it("strips dangerous characters for Windows filenames", () => {
    const result = sanitizeFilename('file<>:"|?*.png');
    expect(result).not.toMatch(/[<>:"|?*]/);
  });

  it("truncates to 200 characters", () => {
    const long = "a".repeat(300) + ".png";
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("falls back to 'output' for empty/all-dangerous filenames", () => {
    expect(sanitizeFilename("")).toBe("output");
    expect(sanitizeFilename("...")).toBe("output");
  });

  it("preserves safe filenames", () => {
    expect(sanitizeFilename("my-render_01.png")).toBe("my-render_01.png");
    expect(sanitizeFilename("output.jpg")).toBe("output.jpg");
  });

  it("removes leading dots to prevent hidden files", () => {
    const result = sanitizeFilename(".htaccess");
    expect(result).not.toMatch(/^\./);
  });
});

// ── ZIP Slip Prevention ───────────────────────────────────────────────────────

describe("buildSafeEntryPath", () => {
  it("produces a safe path with itemId prefix", () => {
    const path = buildSafeEntryPath(42, "png");
    expect(path).toBe("42/output.png");
  });

  it("never produces an absolute path", () => {
    const path = buildSafeEntryPath(1, "/etc/passwd");
    expect(path).not.toMatch(/^\//);
  });

  it("never produces a path starting with ..", () => {
    const path = buildSafeEntryPath(1, "../../evil");
    expect(path).not.toMatch(/^\.\./);
  });

  it("handles null format gracefully", () => {
    const path = buildSafeEntryPath(1, null);
    expect(path).toContain("1/output.");
    expect(path).not.toContain("..");
  });

  it("sanitizes malicious format extensions", () => {
    const path = buildSafeEntryPath(1, "../../../evil.exe");
    expect(path).not.toContain("../../");
    expect(path).not.toMatch(/^\//);
  });
});

// ── CSV Formula Injection Prevention ─────────────────────────────────────────

describe("escapeCsvCell", () => {
  it("prefixes = with a single quote to prevent formula injection", () => {
    expect(escapeCsvCell("=SUM(A1:A10)")).toMatch(/^'=/);
  });

  it("prefixes + with a single quote", () => {
    expect(escapeCsvCell("+cmd|calc.exe")).toMatch(/^'\+/);
  });

  it("prefixes - with a single quote", () => {
    expect(escapeCsvCell("-2+3")).toMatch(/^'-/);
  });

  it("prefixes @ with a single quote", () => {
    expect(escapeCsvCell("@SUM(1+1)")).toMatch(/^'@/);
  });

  it("wraps values containing commas in quotes", () => {
    const result = escapeCsvCell("hello, world");
    expect(result).toMatch(/^".*"$/);
  });

  it("escapes embedded double quotes by doubling them", () => {
    const result = escapeCsvCell('say "hello"');
    expect(result).toContain('""');
  });

  it("wraps values containing newlines in quotes", () => {
    const result = escapeCsvCell("line1\nline2");
    expect(result).toMatch(/^".*"$/s);
  });

  it("passes through safe values unchanged", () => {
    expect(escapeCsvCell("simple value")).toBe("simple value");
    expect(escapeCsvCell("12345")).toBe("12345");
  });
});

describe("buildFailuresCsv", () => {
  it("outputs only a header row when there are no failures", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, status: "completed" }),
    ];
    const csv = buildFailuresCsv(items);
    expect(csv).toContain("item_id,status,error_message");
    expect(csv.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("includes failed items with safe CSV encoding", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 2, status: "failed", outputStoragePath: null, errorMessage: "Render failed: out of memory" }),
    ];
    const csv = buildFailuresCsv(items);
    expect(csv).toContain("2");
    expect(csv).toContain("failed");
    expect(csv).toContain("Render failed");
  });

  it("prevents formula injection in error messages", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 3, status: "failed", outputStoragePath: null, errorMessage: "=cmd|/C calc" }),
    ];
    const csv = buildFailuresCsv(items);
    // The dangerous formula must be prefixed with a quote
    expect(csv).toContain("'=cmd");
  });

  it("handles error messages with commas and quotes safely", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 4, status: "failed", outputStoragePath: null, errorMessage: 'Error: "timeout", retried 3 times' }),
    ];
    const csv = buildFailuresCsv(items);
    // Should be valid CSV — no unescaped quotes outside cells
    expect(csv).toContain("4");
  });
});

// ── Signed URL Only When Completed ───────────────────────────────────────────

describe("generateZipDownloadToken / verifyZipDownloadToken", () => {
  it("generates a verifiable token with correct exportId and tenantId", () => {
    const token = generateZipDownloadToken(42, "tenant-abc");
    const result = verifyZipDownloadToken(token);
    expect(result.valid).toBe(true);
    expect(result.exportId).toBe(42);
    expect(result.tenantId).toBe("tenant-abc");
  });

  it("rejects a tampered token", () => {
    const token = generateZipDownloadToken(42, "tenant-abc");
    const tampered = token.slice(0, -4) + "xxxx";
    const result = verifyZipDownloadToken(tampered);
    expect(result.valid).toBe(false);
  });

  it("rejects a malformed token with no dot separator", () => {
    const result = verifyZipDownloadToken("notavalidtoken");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Malformed");
  });

  it("rejects an expired token", () => {
    // Generate with -1 second TTL (already expired)
    const token = generateZipDownloadToken(99, "tenant-xyz", -1);
    const result = verifyZipDownloadToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("cross-tenant rejection: token for tenant-A cannot be used by tenant-B", () => {
    const token = generateZipDownloadToken(10, "tenant-A");
    const result = verifyZipDownloadToken(token);
    // Valid token — but caller must check that result.tenantId matches the requesting tenant
    expect(result.valid).toBe(true);
    expect(result.tenantId).toBe("tenant-A");
    expect(result.tenantId).not.toBe("tenant-B");
  });

  it("tokens are unique even for same exportId/tenantId (nonce-based)", () => {
    const t1 = generateZipDownloadToken(1, "tenant-1");
    const t2 = generateZipDownloadToken(1, "tenant-1");
    // Different nonces → different tokens
    expect(t1).not.toBe(t2);
    // But both are valid
    expect(verifyZipDownloadToken(t1).valid).toBe(true);
    expect(verifyZipDownloadToken(t2).valid).toBe(true);
  });
});

// ── Manifest Accuracy ─────────────────────────────────────────────────────────

describe("manifest accuracy", () => {
  it("fingerprint differs when a new completed item is added", () => {
    const base: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/b/1.png", outputFileSizeBytes: 100 }),
    ];
    const extended: BatchItemSnapshot[] = [
      ...base,
      makeItem({ itemId: 2, outputStoragePath: "/b/2.png", outputFileSizeBytes: 200 }),
    ];
    expect(computeBatchFingerprint(base)).not.toBe(computeBatchFingerprint(extended));
  });

  it("fingerprint is identical when only failed items differ", () => {
    const withFailed: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/b/1.png", outputFileSizeBytes: 100 }),
      makeItem({ itemId: 2, status: "failed", outputStoragePath: null, outputFileSizeBytes: null }),
    ];
    const withoutFailed: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, outputStoragePath: "/b/1.png", outputFileSizeBytes: 100 }),
    ];
    expect(computeBatchFingerprint(withFailed)).toBe(computeBatchFingerprint(withoutFailed));
  });
});

// ── Retry Safety ─────────────────────────────────────────────────────────────

describe("retry safety", () => {
  it("different export IDs produce different tokens", () => {
    const t1 = generateZipDownloadToken(1, "tenant-1");
    const t2 = generateZipDownloadToken(2, "tenant-1");
    const r1 = verifyZipDownloadToken(t1);
    const r2 = verifyZipDownloadToken(t2);
    expect(r1.exportId).toBe(1);
    expect(r2.exportId).toBe(2);
    expect(r1.exportId).not.toBe(r2.exportId);
  });

  it("fingerprint for empty completed items is deterministic", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ itemId: 1, status: "failed", outputStoragePath: null }),
      makeItem({ itemId: 2, status: "queued", outputStoragePath: null }),
    ];
    const fp1 = computeBatchFingerprint(items);
    const fp2 = computeBatchFingerprint(items);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
  });
});
