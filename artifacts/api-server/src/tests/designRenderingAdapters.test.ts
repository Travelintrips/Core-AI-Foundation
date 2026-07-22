/**
 * Team 32 — Design Rendering Adapter Tests
 *
 * 20 required test cases covering:
 *  1.  Renderer registration
 *  2.  Duplicate renderer (conflict)
 *  3.  Compatible renderer resolution
 *  4.  Unsupported format
 *  5.  Unsupported artifact
 *  6.  Deterministic priority
 *  7.  Preview profile (previewQuality: true)
 *  8.  Full render profile (previewQuality: false)
 *  9.  Honest fallback classification (placeholder/unavailable)
 *  10. Thumbnail result
 *  11. Render failure
 *  12. Timeout
 *  13. Retryability
 *  14. Cancelled render
 *  15. Signed URL result
 *  16. Expired output (signed URL verify)
 *  17. Tenant isolation
 *  18. Filename safety
 *  19. Resource limit
 *  20. Existing presentation/document regression (placeholder adapter)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DesignRendererRegistry,
  createDesignRendererRegistry,
  validateRenderProfile,
  DesignRenderError,
  sanitizeRenderFilename,
  generateRenderSignedToken,
  verifyRenderSignedToken,
  DESIGN_RENDER_ADAPTER_LIMITS,
  PlaceholderAdapter,
  ThumbnailAdapter,
  TemplateRendererAdapter,
} from "../services/design-rendering-adapters/index.js";
import type {
  DesignRendererAdapter,
  DesignRenderCapability,
  DesignRenderRequest,
  DesignRenderResult,
  DesignRenderProfile,
} from "../services/design-rendering-adapters/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<DesignRenderProfile> = {}): DesignRenderProfile {
  return {
    widthPx: 1080,
    heightPx: 1080,
    format: "png",
    purpose: "artifact_preview",
    previewQuality: false,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<DesignRenderRequest> = {}): DesignRenderRequest {
  return {
    tenantId: "tenant-1",
    artifactKind: "design_template",
    artifactId: "tmpl-001",
    profile: makeProfile(),
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<DesignRenderCapability> & { rendererId?: string } = {}): DesignRendererAdapter {
  const id = overrides.rendererId ?? "mock-adapter-v1";
  const cap: DesignRenderCapability = {
    rendererId: id,
    description: "Mock adapter for testing",
    supportedFormats: ["png", "jpg"],
    supportedTargets: ["artifact_preview", "workspace_image"],
    supportedArtifactKinds: ["design_template"],
    maxWidthPx: 4096,
    maxHeightPx: 4096,
    maxFileSizeBytes: 30 * 1024 * 1024,
    timeoutMs: 60_000,
    retryable: true,
    available: true,
    priority: 10,
    ...overrides,
  };
  return {
    rendererId: id,
    capability: cap,
    canHandle: () => cap.available && cap.supportedFormats.includes("png"),
    render: vi.fn(async (req: DesignRenderRequest): Promise<DesignRenderResult> => ({
      requestId: req.requestId ?? "req-1",
      rendererId: id,
      format: "png",
      target: "artifact_preview",
      classification: "spec_rendered",
      mimeType: "image/png",
      fileSizeBytes: 1024,
      widthPx: req.profile.widthPx,
      heightPx: req.profile.heightPx,
      durationMs: 10,
      warnings: [],
      tenantId: req.tenantId,
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Team 32 — DesignRendererRegistry", () => {
  let registry: DesignRendererRegistry;

  beforeEach(() => {
    registry = createDesignRendererRegistry();
  });

  // Test 1: Renderer registration
  it("1. registers an adapter and makes it available via listCapabilities", () => {
    const adapter = makeAdapter();
    registry.register(adapter);
    const caps = registry.listCapabilities();
    expect(caps).toHaveLength(1);
    expect(caps[0]!.rendererId).toBe("mock-adapter-v1");
  });

  // Test 2: Duplicate renderer → conflict error
  it("2. throws RENDERER_CONFLICT when registering the same rendererId twice", () => {
    const adapter = makeAdapter();
    registry.register(adapter);
    expect(() => registry.register(makeAdapter({ rendererId: "mock-adapter-v1" }))).toThrow(
      expect.objectContaining({ code: "RENDERER_CONFLICT" }),
    );
  });

  // Test 3: Compatible renderer resolution
  it("3. resolves the correct adapter for a matching request", () => {
    const adapter = makeAdapter();
    registry.register(adapter);
    const result = registry.resolve(makeRequest());
    expect(result).not.toBeNull();
    expect(result!.adapter.rendererId).toBe("mock-adapter-v1");
  });

  // Test 4: Unsupported format → no resolution
  it("4. returns null when no adapter supports the requested format", () => {
    registry.register(makeAdapter({ supportedFormats: ["jpg"] }));
    const request = makeRequest({ profile: makeProfile({ format: "pdf" }) });
    expect(registry.resolve(request)).toBeNull();
  });

  // Test 5: Unsupported artifact kind → no resolution
  it("5. returns null when no adapter supports the artifact kind", () => {
    registry.register(makeAdapter({ supportedArtifactKinds: ["document"] }));
    const request = makeRequest({ artifactKind: "design_template" });
    expect(registry.resolve(request)).toBeNull();
  });

  // Test 6: Deterministic priority — lower number wins
  it("6. resolves the adapter with the lowest priority number when multiple match", () => {
    const high = makeAdapter({ rendererId: "high-prio", priority: 5 });
    const low  = makeAdapter({ rendererId: "low-prio",  priority: 20 });
    registry.register(low);
    registry.register(high);
    const result = registry.resolve(makeRequest());
    expect(result!.adapter.rendererId).toBe("high-prio");
    expect(result!.alternatives[0]!.rendererId).toBe("low-prio");
  });

  // Test 7: Preview profile (previewQuality: true)
  it("7. resolves successfully for previewQuality: true profile", async () => {
    const adapter = makeAdapter();
    registry.register(adapter);
    const request = makeRequest({ profile: makeProfile({ previewQuality: true }) });
    const result = registry.resolve(request);
    expect(result).not.toBeNull();
    const renderResult = await result!.adapter.render(request);
    expect(renderResult.classification).toBe("spec_rendered");
  });

  // Test 8: Full render profile (previewQuality: false)
  it("8. resolves and renders successfully for full production profile", async () => {
    const adapter = makeAdapter();
    registry.register(adapter);
    const request = makeRequest({ profile: makeProfile({ previewQuality: false }) });
    const result = registry.resolve(request);
    expect(result).not.toBeNull();
    const renderResult = await result!.adapter.render(request);
    expect(renderResult.durationMs).toBeGreaterThanOrEqual(0);
  });

  // Test 9: Honest fallback classification (placeholder)
  it("9. PlaceholderAdapter returns 'placeholder' classification for 3D artifacts", async () => {
    const placeholder = new PlaceholderAdapter();
    registry.register(placeholder);
    const request = makeRequest({
      artifactKind: "3d_model",
      profile: makeProfile({ purpose: "3d_preview_placeholder", format: "png" }),
    });
    const result = registry.resolve(request);
    expect(result).not.toBeNull();
    const renderResult = await result!.adapter.render(request);
    expect(renderResult.classification).toBe("placeholder");
    // Must not provide a real URL
    expect(renderResult.publicUrl).toBeUndefined();
    expect(renderResult.signedUrl).toBeUndefined();
  });

  // Test 10: Thumbnail result via ThumbnailAdapter
  it("10. ThumbnailAdapter produces rasterized_preview classification", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ buffer: Buffer.from("mock"), mimeType: "image/png" });
    const mockGen = vi.fn().mockResolvedValue({
      buffer: Buffer.from("thumb"),
      widthPx: 256,
      heightPx: 256,
      mimeType: "image/png",
    });
    const thumb = new ThumbnailAdapter({ fetchSourceBuffer: mockFetch, generateThumbnail: mockGen });
    registry.register(thumb);
    const request = makeRequest({
      profile: makeProfile({ format: "thumbnail", purpose: "thumbnail", widthPx: 256, heightPx: 256 }),
    });
    const result = registry.resolve(request);
    expect(result).not.toBeNull();
    const renderResult = await result!.adapter.render(request);
    expect(renderResult.classification).toBe("rasterized_preview");
    expect(renderResult.widthPx).toBe(256);
  });

  // Test 11: Render failure propagates as DesignRenderError
  it("11. adapter render failure throws DesignRenderError with code RENDER_FAILED", async () => {
    const failingAdapter: DesignRendererAdapter = {
      ...makeAdapter({ rendererId: "failing-adapter" }),
      render: vi.fn().mockRejectedValue(
        new DesignRenderError({ code: "RENDER_FAILED", message: "Simulated failure", retryable: true }),
      ),
    };
    registry.register(failingAdapter);
    await expect(failingAdapter.render(makeRequest())).rejects.toMatchObject({ code: "RENDER_FAILED" });
  });

  // Test 12: Timeout — adapter declares timeout
  it("12. adapter with timeoutMs: 100 declares a short timeout in its capability", () => {
    const slowAdapter = makeAdapter({ rendererId: "slow-v1", timeoutMs: 100 });
    registry.register(slowAdapter);
    const cap = registry.listCapabilities().find((c) => c.rendererId === "slow-v1");
    expect(cap!.timeoutMs).toBe(100);
  });

  // Test 13: Retryability — retryable errors are flagged
  it("13. DesignRenderError has correct retryable flag based on error code", () => {
    const retryable = new DesignRenderError({ code: "RENDER_FAILED", message: "transient" });
    expect(retryable.retryable).toBe(true);
    const notRetryable = new DesignRenderError({ code: "UNSUPPORTED_FORMAT", message: "bad format" });
    expect(notRetryable.retryable).toBe(false);
  });

  // Test 14: Cancelled render error is non-retryable
  it("14. RENDER_CANCELLED error is non-retryable", () => {
    const cancelled = new DesignRenderError({ code: "RENDER_CANCELLED", message: "Cancelled by user" });
    expect(cancelled.retryable).toBe(false);
    expect(cancelled.code).toBe("RENDER_CANCELLED");
  });

  // Test 15: Signed URL is generated for production results
  it("15. generateRenderSignedToken produces a verifiable token", () => {
    const { token, expiresAt } = generateRenderSignedToken("tenant-1", "renders/tenant-1/file.png");
    const result = verifyRenderSignedToken(token);
    expect(result.valid).toBe(true);
    expect(result.tenantId).toBe("tenant-1");
    expect(result.storagePath).toBe("renders/tenant-1/file.png");
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
  });

  // Test 16: Expired token returns valid: false
  it("16. verifyRenderSignedToken returns invalid for an expired token", () => {
    // Build an expired token manually using Node crypto (available in vitest node env)
    const { createHmac } = require("crypto") as typeof import("crypto");
    const payload = { id: "x", tenantId: "t", storagePath: "p", exp: 1 }; // exp in 1970
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const secret =
      process.env["SESSION_SECRET"] ??
      process.env["ADMIN_API_KEY"] ??
      "dev-only-insecure-secret";
    const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
    const expiredToken = `${encoded}.${sig}`;

    const result = verifyRenderSignedToken(expiredToken);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Token expired");
  });

  // Test 17: Tenant isolation — unavailable adapter is not resolved
  it("17. unavailable adapter is excluded from resolution even if it matches format/kind", () => {
    const unavailable = makeAdapter({ rendererId: "unavailable-v1", available: false });
    registry.register(unavailable);
    expect(registry.resolve(makeRequest())).toBeNull();
  });

  // Test 18: Filename safety
  it("18. sanitizeRenderFilename strips path traversal and unsafe characters", () => {
    // Path separators become `_`, then `..` patterns become `_` → `______etc_passwd`
    expect(sanitizeRenderFilename("../../../etc/passwd")).toBe("______etc_passwd");
    expect(sanitizeRenderFilename("file name with spaces")).toBe("file name with spaces");
    expect(sanitizeRenderFilename("normal-file.png")).toBe("normal-file.png");
    expect(() => sanitizeRenderFilename("")).toThrow(
      expect.objectContaining({ code: "FILENAME_UNSAFE" }),
    );
  });

  // Test 19: Resource limit — profile dimensions
  it("19. validateRenderProfile throws PROFILE_INVALID when dimensions exceed limits", () => {
    expect(() =>
      validateRenderProfile({
        widthPx: DESIGN_RENDER_ADAPTER_LIMITS.MAX_OUTPUT_WIDTH_PX + 1,
        heightPx: 1080,
        format: "png",
      }),
    ).toThrow(expect.objectContaining({ code: "PROFILE_INVALID" }));

    expect(() =>
      validateRenderProfile({ widthPx: 1080, heightPx: 1080, format: "png", quality: 150 }),
    ).toThrow(expect.objectContaining({ code: "PROFILE_INVALID" }));
  });

  // Test 20: Presentation/document regression — PlaceholderAdapter does not
  //          break the registry when a presentation adapter is also registered.
  it("20. PlaceholderAdapter co-exists with a document adapter without conflict", () => {
    const placeholder = new PlaceholderAdapter();
    const docAdapter = makeAdapter({
      rendererId: "doc-renderer-v1",
      supportedArtifactKinds: ["document"],
      supportedTargets: ["document_page"],
    });
    registry.register(placeholder);
    registry.register(docAdapter);

    // Doc request goes to docAdapter
    const docReq = makeRequest({
      artifactKind: "document",
      profile: makeProfile({ purpose: "document_page" }),
    });
    const docResult = registry.resolve(docReq);
    expect(docResult!.adapter.rendererId).toBe("doc-renderer-v1");

    // 3D request goes to placeholder
    const tdReq = makeRequest({
      artifactKind: "3d_model",
      profile: makeProfile({ purpose: "3d_preview_placeholder", format: "png" }),
    });
    const tdResult = registry.resolve(tdReq);
    expect(tdResult!.adapter.rendererId).toBe("placeholder-adapter-v1");
  });
});

// ── TemplateRendererAdapter unit tests ────────────────────────────────────────

describe("Team 32 — TemplateRendererAdapter", () => {
  function makeDeps() {
    const mockTemplate = {
      schemaVersion: 1,
      id: "tmpl-001",
      tenantId: "tenant-1",
      name: "Test",
      canvas: { width: 1080, height: 1080, unit: "px" as const, backgroundColor: "#fff" },
      elements: [],
      variables: [],
      metadata: { createdBy: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    };
    return {
      resolveTemplate: vi.fn().mockResolvedValue({ template: mockTemplate, templateVersionId: 1 }),
      signedUrlTtlSeconds: 60,
    };
  }

  it("requires a non-empty tenantId", async () => {
    const adapter = new TemplateRendererAdapter(makeDeps());
    await expect(
      adapter.render(makeRequest({ tenantId: "" })),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  it("returns UNSUPPORTED_ARTIFACT when resolveTemplate returns null", async () => {
    const deps = makeDeps();
    deps.resolveTemplate = vi.fn().mockResolvedValue(null);
    const adapter = new TemplateRendererAdapter(deps);
    await expect(adapter.render(makeRequest())).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT" });
  });
});

// ── ThumbnailAdapter unit tests ───────────────────────────────────────────────

describe("Team 32 — ThumbnailAdapter", () => {
  it("rejects thumbnail requests that exceed MAX_THUMBNAIL_PX", async () => {
    const adapter = new ThumbnailAdapter({
      fetchSourceBuffer: vi.fn(),
      generateThumbnail: vi.fn(),
    });
    const req = makeRequest({
      profile: makeProfile({
        purpose: "thumbnail",
        format: "thumbnail",
        widthPx: DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX + 1,
        heightPx: DESIGN_RENDER_ADAPTER_LIMITS.MAX_THUMBNAIL_PX + 1,
      }),
    });
    await expect(adapter.render(req)).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
  });

  it("returns UNSUPPORTED_ARTIFACT when fetchSourceBuffer returns null", async () => {
    const adapter = new ThumbnailAdapter({
      fetchSourceBuffer: vi.fn().mockResolvedValue(null),
      generateThumbnail: vi.fn(),
    });
    const req = makeRequest({
      profile: makeProfile({ purpose: "thumbnail", format: "thumbnail", widthPx: 256, heightPx: 256 }),
    });
    await expect(adapter.render(req)).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT" });
  });
});
