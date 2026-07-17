/**
 * resourceLimits.test.ts — Team 14  (P1 RESOURCE LIMIT)
 *
 * Required test cases per remediation spec:
 *   ✓ oversized input ditolak (SVG too large)
 *   ✓ canvas dimensions too large rejected
 */

import { describe, it, expect } from "vitest";
import { SvgRendererAdapter } from "../adapters/SvgRendererAdapter.js";
import { RenderError }        from "../errors.js";
import { UNIVERSAL_RENDER_LIMITS } from "../resourceLimits.js";

const adapter = new SvgRendererAdapter();

const VALID_SVG = '<svg width="100" height="100"><rect/></svg>';

describe("SvgRendererAdapter — resource limits", () => {
  it("throws SVG_CONTENT_MISSING for empty svgContent", async () => {
    await expect(adapter.render({ svgContent: "", canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SVG_CONTENT_MISSING",
    });
  });

  it("throws SVG_TOO_LARGE when SVG exceeds MAX_SVG_BYTES", async () => {
    const huge = "A".repeat(UNIVERSAL_RENDER_LIMITS.MAX_SVG_BYTES + 1);
    await expect(adapter.render({ svgContent: huge, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SVG_TOO_LARGE",
    });
  });

  it("throws CANVAS_LIMIT_EXCEEDED when pixel count exceeds limit", async () => {
    const w = UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_WIDTH;
    const h = UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_HEIGHT;
    // Maximally oversized canvas
    await expect(
      adapter.render({ svgContent: VALID_SVG, canvasWidth: w + 1, canvasHeight: h + 1 }),
    ).rejects.toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
  });

  it("throws SVG_SANITISE_FAILED for <script> tag", async () => {
    const xss = '<svg><script>alert(1)</script></svg>';
    await expect(adapter.render({ svgContent: xss, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SVG_SANITISE_FAILED",
    });
  });

  it("throws SVG_SANITISE_FAILED for on* event handler", async () => {
    const xss = '<svg><rect onclick="evil()"/></svg>';
    await expect(adapter.render({ svgContent: xss, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SVG_SANITISE_FAILED",
    });
  });

  it("throws SVG_SANITISE_FAILED for javascript: URI", async () => {
    const xss = '<svg><a href="javascript:alert(1)"><rect/></a></svg>';
    await expect(adapter.render({ svgContent: xss, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SVG_SANITISE_FAILED",
    });
  });

  it("throws SVG_SANITISE_FAILED for <foreignObject> (XSS vector)", async () => {
    const xss = '<svg><foreignObject><div>evil</div></foreignObject></svg>';
    await expect(adapter.render({ svgContent: xss, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SVG_SANITISE_FAILED",
    });
  });

  it("throws SVG_SANITISE_FAILED for XML ENTITY declaration (XXE)", async () => {
    const xxe = '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg/>';
    await expect(adapter.render({ svgContent: xxe, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SVG_SANITISE_FAILED",
    });
  });

  it("throws SSRF_BLOCKED for http:// external URL in SVG", async () => {
    const svg = '<svg><image href="http://example.com/img.png"/></svg>';
    await expect(adapter.render({ svgContent: svg, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("throws SSRF_BLOCKED for https:// pointing to private network", async () => {
    const svg = '<svg><image href="https://192.168.1.1/logo.png"/></svg>';
    await expect(adapter.render({ svgContent: svg, canvasWidth: 100, canvasHeight: 100 })).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("accepts valid SVG with no external refs", async () => {
    const { svgString, warnings } = await adapter.render({
      svgContent:   VALID_SVG,
      canvasWidth:  800,
      canvasHeight: 600,
    });
    expect(svgString).toContain("<svg");
    expect(warnings).toBeInstanceOf(Array);
  });

  it("accepts valid SVG with a public https:// URL", async () => {
    const svg = '<svg><image href="https://cdn.example.com/logo.png"/></svg>';
    await expect(adapter.render({ svgContent: svg, canvasWidth: 100, canvasHeight: 100 })).resolves.toBeDefined();
  });
});

describe("UNIVERSAL_RENDER_LIMITS constants", () => {
  it("MAX_SVG_BYTES is 5 MB", () => {
    expect(UNIVERSAL_RENDER_LIMITS.MAX_SVG_BYTES).toBe(5 * 1024 * 1024);
  });

  it("MAX_PAYLOAD_BYTES is 10 MB", () => {
    expect(UNIVERSAL_RENDER_LIMITS.MAX_PAYLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it("MAX_CANVAS_WIDTH is 8192", () => {
    expect(UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_WIDTH).toBe(8_192);
  });

  it("MAX_ASSET_COUNT is 50", () => {
    expect(UNIVERSAL_RENDER_LIMITS.MAX_ASSET_COUNT).toBe(50);
  });

  it("MAX_RENDER_DURATION_MS is 60 seconds", () => {
    expect(UNIVERSAL_RENDER_LIMITS.MAX_RENDER_DURATION_MS).toBe(60_000);
  });
});
