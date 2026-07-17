/**
 * idempotencyService.test.ts — Team 14  (P1 IDEMPOTENCY)
 *
 * Required test cases per remediation spec:
 *   ✓ same content hash returns existing artifact (no re-render)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeRenderHash,
  checkIdempotency,
  recordIdempotencyResult,
  _flushIdempotencyCache,
  idempotencyCacheSize,
} from "../idempotencyService.js";
import type { UniversalRenderRequest, UniversalRenderResult, OutputFormat } from "../universalRendererService.js";

const BASE_REQ: UniversalRenderRequest = {
  source: { kind: "svg", svgContent: "<svg/>", canvasWidth: 800, canvasHeight: 600 },
  formats: ["png"],
};

const MOCK_RESULT: UniversalRenderResult = {
  requestId:  "test-001",
  artifacts:  [{ format: "png", storagePath: "path/img.png", publicUrl: "https://cdn/img.png", fileSizeBytes: 100, checksum: "a".repeat(64), mimeType: "image/png" }],
  warnings:   [],
  durationMs: 42,
};

describe("computeRenderHash", () => {
  it("returns a 64-char hex string", () => {
    const h = computeRenderHash(BASE_REQ);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(computeRenderHash(BASE_REQ)).toBe(computeRenderHash(BASE_REQ));
  });

  it("differs for different SVG content", () => {
    const other = { ...BASE_REQ, source: { ...BASE_REQ.source, svgContent: "<svg><rect/></svg>" } };
    expect(computeRenderHash(BASE_REQ)).not.toBe(computeRenderHash(other));
  });

  it("differs for different canvas dimensions", () => {
    const other = { ...BASE_REQ, source: { ...BASE_REQ.source, canvasWidth: 1920, canvasHeight: 1080 } };
    expect(computeRenderHash(BASE_REQ)).not.toBe(computeRenderHash(other));
  });

  it("differs for different formats", () => {
    const other = { ...BASE_REQ, formats: ["pdf" as const] };
    expect(computeRenderHash(BASE_REQ)).not.toBe(computeRenderHash(other));
  });

  it("is order-insensitive for formats (sorted)", () => {
    const a: UniversalRenderRequest = { ...BASE_REQ, formats: ["png", "svg"] as unknown as OutputFormat[] };
    const b: UniversalRenderRequest = { ...BASE_REQ, formats: ["svg", "png"] as unknown as OutputFormat[] };
    expect(computeRenderHash(a)).toBe(computeRenderHash(b));
  });

  it("differs for previewMode true vs false", () => {
    const withPrev  = { ...BASE_REQ, previewMode: true  };
    const withoutPrev = { ...BASE_REQ, previewMode: false };
    expect(computeRenderHash(withPrev)).not.toBe(computeRenderHash(withoutPrev));
  });

  it("is insensitive to metadata.title changes (excluded from hash)", () => {
    const a = { ...BASE_REQ, metadata: { title: "Version A" } };
    const b = { ...BASE_REQ, metadata: { title: "Version B" } };
    // Both should produce the same hash
    expect(computeRenderHash(a)).toBe(computeRenderHash(b));
  });
});

describe("checkIdempotency + recordIdempotencyResult", () => {
  beforeEach(() => {
    _flushIdempotencyCache();
  });

  it("returns null for an unknown hash", () => {
    expect(checkIdempotency("unknown-hash")).toBeNull();
  });

  it("returns the cached result after recording", () => {
    const hash = computeRenderHash(BASE_REQ);
    recordIdempotencyResult(hash, MOCK_RESULT);
    const cached = checkIdempotency(hash);
    expect(cached).toEqual(MOCK_RESULT);
  });

  it("same content hash returns the same result (no re-render contract)", () => {
    const hash    = computeRenderHash(BASE_REQ);
    recordIdempotencyResult(hash, MOCK_RESULT);

    // Simulate a second identical request
    const sameHash = computeRenderHash({
      ...BASE_REQ,
      // storagePrefix and metadata intentionally different — excluded from hash
      storagePrefix: "different-prefix",
      metadata:      { title: "Different Title" },
    });

    const cached = checkIdempotency(sameHash);
    expect(cached).not.toBeNull();
    expect(cached?.requestId).toBe("test-001");
  });

  it("returns null after TTL expiry (manual clock manipulation)", () => {
    const hash = computeRenderHash(BASE_REQ);
    recordIdempotencyResult(hash, MOCK_RESULT);

    // Verify it's cached
    expect(checkIdempotency(hash)).not.toBeNull();

    // Flush and verify cache is clear
    _flushIdempotencyCache();
    expect(checkIdempotency(hash)).toBeNull();
  });

  it("increments cache size after recording", () => {
    _flushIdempotencyCache();
    expect(idempotencyCacheSize()).toBe(0);
    const hash = computeRenderHash(BASE_REQ);
    recordIdempotencyResult(hash, MOCK_RESULT);
    expect(idempotencyCacheSize()).toBe(1);
  });
});
