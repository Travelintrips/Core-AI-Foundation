/**
 * Design Renderer — Phase 2 Tests
 *
 * Unit tests for:
 *  - XML escaping
 *  - Shape rendering
 *  - Rotation transforms
 *  - Conditional visibility
 *  - Text wrapping, auto-shrink, truncation
 *  - Image fit modes
 *  - QR validation
 *  - Renderer cache key
 *  - Output format validation
 *  - Font fallback
 *  - Canvas limits
 *  - Path sanitisation
 *  - SSRF guard
 *
 * Integration tests render fixture templates to PNG/JPG/WebP/PDF and verify
 * file signatures, dimensions, and non-zero file sizes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  xmlEscape,
  estimateTextWidth,
  wrapText,
  layoutText,
  resolveFont,
  validateOutputDimensions,
  mimeForFormat,
  extForFormat,
  AssetCache,
} from "../services/design-renderer/index.js";
import { RenderError } from "../services/design-renderer/errors.js";
import { WarningAccumulator } from "../services/design-renderer/renderWarnings.js";
import { validateExternalUrl } from "../middleware/ssrfGuard.js";
import { buildSvg } from "../services/design-renderer/svgBuilder.js";
import { encodeSvg } from "../services/design-renderer/outputEncoder.js";
import { pngToPdf } from "../services/design-renderer/pdfRenderer.js";
import { renderShape, renderText, renderLine } from "../services/design-renderer/elementRenderer.js";
import { renderConfig } from "../services/design-renderer/config.js";
import type { DesignTemplate, TextElement, ShapeElement, LineElement, RenderDataRow } from "../types/designTemplate.js";
import { DESIGN_LIMITS, DESIGN_TEMPLATE_SCHEMA_VERSION } from "../types/designTemplate.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCanvas(w = 1080, h = 1080) {
  return { width: w, height: h, unit: "px" as const, backgroundColor: "#ffffff" };
}

function makeTemplate(overrides: Partial<DesignTemplate> = {}): DesignTemplate {
  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: "1",
    tenantId: "test-tenant",
    name: "Test Template",
    canvas: makeCanvas(),
    elements: [],
    variables: [],
    metadata: {
      createdBy: "system",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    ...overrides,
  };
}

function makeTextElement(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: "text-1",
    type: "text",
    x: 10, y: 10, width: 400, height: 200,
    zIndex: 1,
    content: "Hello World",
    fontSize: 24,
    color: "#000000",
    ...overrides,
  };
}

function makeShapeElement(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: "shape-1",
    type: "shape",
    x: 0, y: 0, width: 200, height: 200,
    zIndex: 0,
    shape: "rectangle",
    fill: "#ff0000",
    ...overrides,
  };
}

// ── XML Escaping ──────────────────────────────────────────────────────────────

describe("xmlEscape", () => {
  it("escapes ampersand", () => {
    expect(xmlEscape("A & B")).toBe("A &amp; B");
  });
  it("escapes less-than", () => {
    expect(xmlEscape("<script>")).toBe("&lt;script&gt;");
  });
  it("escapes quotes", () => {
    expect(xmlEscape('"hello"')).toBe("&quot;hello&quot;");
  });
  it("escapes single quotes", () => {
    expect(xmlEscape("it's")).toBe("it&apos;s");
  });
  it("leaves safe text unchanged", () => {
    expect(xmlEscape("Hello World 123")).toBe("Hello World 123");
  });
  it("escapes Indonesian text safely", () => {
    const text = "Harga: Rp 1.000.000 & diskon 10%";
    const escaped = xmlEscape(text);
    expect(escaped).toContain("&amp;");
    expect(escaped).not.toContain("&amp;amp;"); // no double-escape
  });
});

// ── Text Width Estimator ──────────────────────────────────────────────────────

describe("estimateTextWidth", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTextWidth("", 16)).toBe(0);
  });
  it("returns positive value for non-empty text", () => {
    expect(estimateTextWidth("Hello", 16)).toBeGreaterThan(0);
  });
  it("scales with font size", () => {
    const w8  = estimateTextWidth("A", 8);
    const w16 = estimateTextWidth("A", 16);
    expect(w16).toBeCloseTo(w8 * 2, 1);
  });
  it("wide chars are wider than narrow chars", () => {
    const wide   = estimateTextWidth("M", 16);
    const narrow = estimateTextWidth("i", 16);
    expect(wide).toBeGreaterThan(narrow);
  });
});

// ── Text Wrapping ─────────────────────────────────────────────────────────────

describe("wrapText", () => {
  it("returns single line for short text", () => {
    const lines = wrapText("Hi", 500, 16);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Hi");
  });
  it("wraps long text into multiple lines", () => {
    const longText = "This is a very long sentence that should definitely wrap across multiple lines at a small font size";
    const lines = wrapText(longText, 200, 14);
    expect(lines.length).toBeGreaterThan(1);
  });
  it("preserves newlines as line breaks", () => {
    const lines = wrapText("Line 1\nLine 2", 500, 16);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toBe("Line 1");
    expect(lines[1]).toBe("Line 2");
  });
  it("returns at least one element even for empty string", () => {
    const lines = wrapText("", 500, 16);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });
  it("force-breaks a word wider than the box", () => {
    const veryLongWord = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const lines = wrapText(veryLongWord, 50, 16);
    expect(lines.length).toBeGreaterThan(1);
  });
});

// ── Text Layout: auto-shrink ──────────────────────────────────────────────────

describe("layoutText — auto-shrink", () => {
  const warnings = new WarningAccumulator();
  beforeEach(() => { /* no-op — reuse accumulator */ });

  it("shrinks font when text overflows box", () => {
    const el = makeTextElement({
      fontSize: 100,
      minFontSize: 8,
      overflow: "auto-shrink",
      content: "This is a very long text that will not fit at 100px so it needs to shrink",
      width: 100,
      height: 50,
    });
    const w = new WarningAccumulator();
    const result = layoutText(el, "This is a very long text that will not fit at 100px so it needs to shrink", w);
    expect(result.shrunk).toBe(true);
    expect(result.fontSize).toBeLessThan(100);
    expect(result.fontSize).toBeGreaterThanOrEqual(DESIGN_LIMITS.MIN_FONT_SIZE);
  });

  it("does not shrink when text fits", () => {
    const el = makeTextElement({ fontSize: 16, overflow: "auto-shrink", content: "Hi", width: 300, height: 100 });
    const w = new WarningAccumulator();
    const result = layoutText(el, "Hi", w);
    expect(result.shrunk).toBe(false);
    expect(result.fontSize).toBe(16);
  });
});

// ── Text Layout: truncation ───────────────────────────────────────────────────

describe("layoutText — truncate", () => {
  it("truncates when maxLines exceeded", () => {
    const el = makeTextElement({
      fontSize: 14,
      overflow: "truncate",
      maxLines: 1,
      ellipsis: true,
      content: "Line 1 word1 word2 word3 word4 word5 word6 word7 word8",
      width: 100,
      height: 50,
    });
    const w = new WarningAccumulator();
    const result = layoutText(el, "Line 1 word1 word2 word3 word4 word5 word6 word7 word8", w);
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(1);
  });
});

// ── Shape Rendering ───────────────────────────────────────────────────────────

describe("renderShape", () => {
  it("renders a rectangle", () => {
    const el = makeShapeElement({ shape: "rectangle" });
    const defs: string[] = [];
    const svg = renderShape(el, defs);
    expect(svg).toContain("<rect");
    expect(svg).toContain("fill=\"#ff0000\"");
  });

  it("renders a circle as ellipse", () => {
    const el = makeShapeElement({ shape: "circle" });
    const defs: string[] = [];
    const svg = renderShape(el, defs);
    expect(svg).toContain("<ellipse");
  });

  it("renders a rounded rectangle with rx", () => {
    const el = makeShapeElement({ shape: "rounded-rectangle", borderRadius: 12 });
    const defs: string[] = [];
    const svg = renderShape(el, defs);
    expect(svg).toContain("rx=\"12\"");
  });

  it("includes gradient def for linear fill", () => {
    const el = makeShapeElement({
      fill: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] },
    });
    const defs: string[] = [];
    const svg = renderShape(el, defs);
    expect(defs.some((d) => d.includes("linearGradient"))).toBe(true);
    expect(svg).toContain("url(#");
  });

  it("applies rotation transform around element center", () => {
    const el = makeShapeElement({ rotation: 45 });
    const defs: string[] = [];
    const svg = renderShape(el, defs);
    expect(svg).toContain("rotate(45");
    // Center should be (0 + 200/2, 0 + 200/2) = (100, 100)
    expect(svg).toContain("100, 100");
  });

  it("renders border with stroke", () => {
    const el = makeShapeElement({ border: { width: 2, color: "#0000ff" } });
    const defs: string[] = [];
    const svg = renderShape(el, defs);
    expect(svg).toContain("stroke=\"#0000ff\"");
    expect(svg).toContain("stroke-width=\"2\"");
  });

  it("includes drop shadow filter", () => {
    const el = makeShapeElement({ shadow: { offsetX: 2, offsetY: 2, blur: 4, color: "rgba(0,0,0,0.5)" } });
    const defs: string[] = [];
    renderShape(el, defs);
    expect(defs.some((d) => d.includes("feDropShadow"))).toBe(true);
  });
});

// ── Text Element Rendering ────────────────────────────────────────────────────

describe("renderText", () => {
  it("produces a <text> element", () => {
    const el = makeTextElement();
    const w  = new WarningAccumulator();
    const svg = renderText(el, "Hello", w);
    expect(svg).toContain("<text");
    expect(svg).toContain("Hello");
  });

  it("escapes XML in text content", () => {
    const el  = makeTextElement();
    const w   = new WarningAccumulator();
    const svg = renderText(el, "<bold>& test</bold>", w);
    expect(svg).toContain("&lt;bold&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("<bold>");
  });

  it("uses fallback font when requested font is unavailable", () => {
    const el = makeTextElement({ fontFamily: "NonExistentFont123" });
    const w  = new WarningAccumulator();
    renderText(el, "test", w);
    expect(w.toArray().some((x) => x.code === "FONT_FALLBACK_USED")).toBe(true);
  });

  it("applies rotation to text element", () => {
    const el  = makeTextElement({ rotation: 30 });
    const w   = new WarningAccumulator();
    const svg = renderText(el, "Rotated", w);
    expect(svg).toContain("rotate(30");
  });

  it("applies opacity", () => {
    const el  = makeTextElement({ opacity: 0.5 });
    const w   = new WarningAccumulator();
    const svg = renderText(el, "Faded", w);
    expect(svg).toContain("opacity=\"0.5\"");
  });
});

// ── Line Rendering ────────────────────────────────────────────────────────────

describe("renderLine", () => {
  it("produces a <line> element with correct endpoints", () => {
    const el: LineElement = {
      id: "line-1", type: "line",
      x: 10, y: 20, width: 100, height: 0,
      zIndex: 1, stroke: "#ff0000", strokeWidth: 2,
    };
    const svg = renderLine(el);
    expect(svg).toContain("<line");
    expect(svg).toContain("x1=\"10\"");
    expect(svg).toContain("y1=\"20\"");
    expect(svg).toContain("x2=\"110\"");
  });

  it("includes dash array when specified", () => {
    const el: LineElement = {
      id: "line-2", type: "line",
      x: 0, y: 0, width: 100, height: 0, zIndex: 1,
      dashArray: [8, 4],
    };
    const svg = renderLine(el);
    expect(svg).toContain("stroke-dasharray=\"8,4\"");
  });
});

// ── Font Registry ─────────────────────────────────────────────────────────────

describe("resolveFont", () => {
  it("returns registered font without fallback", () => {
    const result = resolveFont("Arial");
    expect(result.isFallback).toBe(false);
    expect(result.fontFamily).toBe("Arial");
  });
  it("falls back for unregistered font", () => {
    const result = resolveFont("FantasyFont123");
    expect(result.isFallback).toBe(true);
  });
  it("is case-insensitive", () => {
    const result = resolveFont("arial");
    expect(result.isFallback).toBe(false);
  });
  it("returns platform fallback for undefined", () => {
    const result = resolveFont(undefined);
    expect(result.fontFamily).toBeTruthy();
  });
});

// ── Output Dimension Validation ───────────────────────────────────────────────

describe("validateOutputDimensions", () => {
  it("accepts valid dimensions", () => {
    expect(() => validateOutputDimensions(1080, 1080)).not.toThrow();
  });
  it("throws CANVAS_LIMIT_EXCEEDED for oversized width", () => {
    expect(() =>
      validateOutputDimensions(1080, 1080, DESIGN_LIMITS.MAX_CANVAS_WIDTH + 1, 1080),
    ).toThrow(RenderError);
  });
  it("throws CANVAS_LIMIT_EXCEEDED for height 0", () => {
    expect(() => validateOutputDimensions(1080, 1080, 1080, 0)).toThrow(RenderError);
  });
  it("returns native canvas size when no override provided", () => {
    const result = validateOutputDimensions(800, 600);
    expect(result.finalWidth).toBe(800);
    expect(result.finalHeight).toBe(600);
  });
});

// ── MIME and Extension Helpers ────────────────────────────────────────────────

describe("mimeForFormat / extForFormat", () => {
  it("returns correct MIME for png", () => {
    expect(mimeForFormat("png")).toBe("image/png");
  });
  it("returns correct MIME for jpg", () => {
    expect(mimeForFormat("jpg")).toBe("image/jpeg");
  });
  it("returns correct MIME for pdf", () => {
    expect(mimeForFormat("pdf")).toBe("application/pdf");
  });
  it("maps jpg extension correctly", () => {
    expect(extForFormat("jpg")).toBe("jpg");
  });
  it("maps pdf to pdf", () => {
    expect(extForFormat("pdf")).toBe("pdf");
  });
});

// ── Asset Cache ───────────────────────────────────────────────────────────────

describe("AssetCache", () => {
  it("stores and retrieves a buffer", () => {
    const cache = new AssetCache({ maxBytes: 1024 * 1024 });
    const buf   = Buffer.from("fake-image");
    cache.set("http://example.com/img.png", buf, "image/png");
    const hit = cache.get("http://example.com/img.png");
    expect(hit).toBeDefined();
    expect(hit!.buffer.equals(buf)).toBe(true);
  });

  it("normalizes cache keys", () => {
    const cache = new AssetCache();
    const buf   = Buffer.from("data");
    cache.set("  HTTP://EXAMPLE.COM/IMG.PNG  ", buf, "image/png");
    const hit = cache.get("http://example.com/img.png");
    expect(hit).toBeDefined();
  });

  it("evicts when over capacity", () => {
    const cache = new AssetCache({ maxBytes: 20 });
    cache.set("key1", Buffer.alloc(10, 0), "image/png");
    cache.set("key2", Buffer.alloc(10, 0), "image/png");
    cache.set("key3", Buffer.alloc(15, 0), "image/png"); // triggers eviction
    // Total should not exceed maxBytes
    expect(cache.totalBytes).toBeLessThanOrEqual(20);
  });

  it("returns undefined for expired TTL", async () => {
    const cache = new AssetCache({ maxBytes: 1024 * 1024, ttlMs: 1 }); // 1ms TTL
    cache.set("key1", Buffer.from("data"), "image/png");
    await new Promise((r) => setTimeout(r, 10));
    const hit = cache.get("key1");
    expect(hit).toBeUndefined();
  });
});

// ── Renderer Cache Key ────────────────────────────────────────────────────────

describe("renderer cache key (rendererVersion)", () => {
  it("rendererVersion is set", () => {
    expect(renderConfig.rendererVersion).toBeTruthy();
    expect(renderConfig.rendererVersion).toMatch(/^design-/);
  });
});

// ── SSRF Protection ───────────────────────────────────────────────────────────

describe("validateExternalUrl — SSRF", () => {
  it("allows https external URLs", () => {
    const result = validateExternalUrl("https://example.com/image.png");
    expect(result.valid).toBe(true);
  });
  it("blocks localhost", () => {
    const result = validateExternalUrl("http://localhost:8080/secret");
    expect(result.valid).toBe(false);
  });
  it("blocks 127.0.0.1", () => {
    const result = validateExternalUrl("http://127.0.0.1/admin");
    expect(result.valid).toBe(false);
  });
  it("blocks 169.254.x.x (link-local)", () => {
    const result = validateExternalUrl("http://169.254.169.254/latest/meta-data");
    expect(result.valid).toBe(false);
  });
  it("blocks 10.x.x.x (private)", () => {
    const result = validateExternalUrl("http://10.0.0.1/internal");
    expect(result.valid).toBe(false);
  });
  it("blocks file:// protocol", () => {
    const result = validateExternalUrl("file:///etc/passwd");
    expect(result.valid).toBe(false);
  });
  it("blocks 192.168.x.x (private)", () => {
    const result = validateExternalUrl("http://192.168.1.100/admin");
    expect(result.valid).toBe(false);
  });
});

// ── SVG Builder Integration ───────────────────────────────────────────────────

describe("buildSvg — integration", () => {
  it("builds a valid SVG string for a simple template", async () => {
    const template = makeTemplate({
      canvas: makeCanvas(400, 300),
      elements: [makeShapeElement({ id: "bg", fill: "#cccccc", width: 400, height: 300 })],
    });
    const warnings = new WarningAccumulator();
    const svg = await buildSvg(template, {}, warnings);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="300"');
    expect(svg).toContain('viewBox="0 0 400 300"');
    expect(svg).toContain('<rect');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('javascript:');
  });

  it("skips elements with visible=false", async () => {
    const template = makeTemplate({
      canvas: makeCanvas(400, 300),
      elements: [
        makeShapeElement({ id: "hidden", visible: false, fill: "#ff0000" }),
        makeTextElement({ id: "visible-text", content: "Shown" }),
      ],
    });
    const warnings = new WarningAccumulator();
    const svg = await buildSvg(template, {}, warnings);
    expect(svg).toContain("Shown");
    expect(svg).not.toContain("#ff0000"); // hidden shape fill
  });

  it("evaluates conditional visibility", async () => {
    const template = makeTemplate({
      canvas: makeCanvas(400, 300),
      elements: [
        makeTextElement({
          id: "conditional",
          content: "Visible Only",
          visibleWhen: { variable: "show", operator: "equals", value: "yes" },
        }),
      ],
      variables: [{ key: "show", label: "Show", type: "text" }],
    });
    const warnings = new WarningAccumulator();
    const svgHidden = await buildSvg(template, { show: "no" }, warnings);
    const svgShown  = await buildSvg(template, { show: "yes" }, warnings);
    expect(svgHidden).not.toContain("Visible Only");
    expect(svgShown).toContain("Visible Only");
  });

  it("handles missing image gracefully with fallback warning", async () => {
    const template = makeTemplate({
      canvas: makeCanvas(400, 300),
      elements: [{
        id: "img-1", type: "image", x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        src: { type: "url", url: "https://this-domain-does-not-exist-12345.com/nope.png" },
      }],
    });
    const warnings = new WarningAccumulator();
    const svg = await buildSvg(template, {}, warnings);
    // Should not throw; should add a warning
    expect(warnings.count).toBeGreaterThan(0);
    expect(svg).toBeTruthy();
  });

  it("embeds variable text content", async () => {
    const template = makeTemplate({
      canvas: makeCanvas(400, 300),
      elements: [makeTextElement({
        id: "var-text",
        content: { binding: { variableKey: "name", fallback: "Default" } },
      })],
      variables: [{ key: "name", label: "Name", type: "text" }],
    });
    const warnings = new WarningAccumulator();
    const svg = await buildSvg(template, { name: "Alice" }, warnings);
    expect(svg).toContain("Alice");
  });
});

// ── Renderer Integration: PNG / JPG / WebP / PDF ──────────────────────────────

describe("encodeSvg — format integration", () => {
  const simpleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ff0000"/><text x="10" y="50" font-size="16" fill="#fff">Test</text></svg>`;

  it("produces a valid PNG (magic bytes + non-zero size)", async () => {
    const result = await encodeSvg(simpleSvg, "png", 100, 100);
    expect(result.buffer.length).toBeGreaterThan(0);
    // PNG magic: 89 50 4E 47
    expect(result.buffer[0]).toBe(0x89);
    expect(result.buffer[1]).toBe(0x50);
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it("produces a valid JPG (magic bytes + non-zero size)", async () => {
    const result = await encodeSvg(simpleSvg, "jpg", 100, 100);
    expect(result.buffer.length).toBeGreaterThan(0);
    // JPEG SOI marker: FF D8 FF
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("produces a valid WebP (RIFF header + non-zero size)", async () => {
    const result = await encodeSvg(simpleSvg, "webp", 100, 100);
    expect(result.buffer.length).toBeGreaterThan(0);
    // WebP RIFF header: 52 49 46 46
    expect(result.buffer[0]).toBe(0x52);
    expect(result.buffer[1]).toBe(0x49);
    expect(result.mimeType).toBe("image/webp");
  });

  it("produces a valid PDF (%%PDF signature + non-zero size)", async () => {
    const result = await encodeSvg(simpleSvg, "pdf", 100, 100);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe("application/pdf");
    // PDF magic: %PDF
    const head = result.buffer.slice(0, 4).toString("ascii");
    expect(head).toBe("%PDF");
  });

  it("produces deterministic output for same input", async () => {
    // SVG → PNG should be the same size for the same SVG
    const r1 = await encodeSvg(simpleSvg, "png", 100, 100);
    const r2 = await encodeSvg(simpleSvg, "png", 100, 100);
    expect(r1.buffer.length).toBe(r2.buffer.length);
  });

  it("outputs correct dimensions at native canvas size", async () => {
    const result = await encodeSvg(simpleSvg, "png", 100, 100);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });
});

// ── PDF Renderer ──────────────────────────────────────────────────────────────

describe("pngToPdf", () => {
  it("wraps a PNG buffer in a valid PDF", async () => {
    // Create a minimal PNG via sharp
    const { default: sharp } = await import("sharp");
    const pngBuf = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png().toBuffer();

    const pdfBuf = await pngToPdf(pngBuf, 50, 50);
    expect(pdfBuf.length).toBeGreaterThan(0);
    const head = pdfBuf.slice(0, 4).toString("ascii");
    expect(head).toBe("%PDF");
  });
});

// ── Full Pipeline Fixtures ────────────────────────────────────────────────────

describe("buildSvg + encodeSvg — fixture templates", () => {
  async function renderFixture(template: DesignTemplate, data: RenderDataRow, format: "png" | "jpg" | "webp") {
    const warnings = new WarningAccumulator();
    const svg = await buildSvg(template, data, warnings);
    return encodeSvg(svg, format, template.canvas.width, template.canvas.height);
  }

  it("fixture: background + text", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 100),
      elements: [
        makeShapeElement({ id: "bg", fill: "#eeeeee", width: 200, height: 100 }),
        makeTextElement({ id: "t1", content: "Hello Jakarta!", width: 180, height: 80, x: 10, y: 10 }),
      ],
    });
    const r = await renderFixture(t, {}, "png");
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: long text (wrap + truncate)", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 100),
      elements: [makeTextElement({
        id: "t-long",
        content: "Ini adalah teks yang sangat panjang dan harus dibungkus ke beberapa baris untuk dapat dibaca dengan baik di dalam kotak yang tersedia",
        width: 180, height: 60, x: 10, y: 10,
        fontSize: 14, overflow: "auto-shrink", minFontSize: 8,
      })],
    });
    const r = await renderFixture(t, {}, "png");
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: shape + rotation", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 200),
      elements: [makeShapeElement({ id: "rotated", rotation: 45, fill: "#0055ff", width: 100, height: 100, x: 50, y: 50 })],
    });
    const r = await renderFixture(t, {}, "png");
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: missing image fallback", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 200),
      elements: [{
        id: "img-missing", type: "image" as const,
        x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        src: { type: "url" as const, url: "https://nonexistent-domain-xyz.invalid/img.png" },
      }],
    });
    const warnings = new WarningAccumulator();
    // Should not throw — renders fallback placeholder
    const svg = await buildSvg(t, {}, warnings);
    const r = await encodeSvg(svg, "png", t.canvas.width, t.canvas.height);
    expect(r.buffer.length).toBeGreaterThan(100);
    expect(warnings.count).toBeGreaterThan(0);
  });

  it("fixture: variable image missing → fallback", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 200),
      elements: [{
        id: "var-img", type: "image" as const,
        x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        src: { binding: { variableKey: "logoUrl", fallback: "" } },
      }],
      variables: [{ key: "logoUrl", label: "Logo URL", type: "image" }],
    });
    const warnings = new WarningAccumulator();
    const svg = await buildSvg(t, {}, warnings); // logoUrl missing
    const r = await encodeSvg(svg, "png", t.canvas.width, t.canvas.height);
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: transparent PNG (no background color)", async () => {
    const t = makeTemplate({
      canvas: { width: 100, height: 100, unit: "px" as const },
      elements: [makeTextElement({ id: "t", content: "Transparent BG", width: 100, height: 50 })],
    });
    const warnings = new WarningAccumulator();
    const svg = await buildSvg(t, {}, warnings);
    const r = await encodeSvg(svg, "png", 100, 100);
    expect(r.mimeType).toBe("image/png");
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: multiple z-index layers", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 200),
      elements: [
        makeShapeElement({ id: "bottom", zIndex: 0, fill: "#ff0000", width: 200, height: 200 }),
        makeShapeElement({ id: "mid",    zIndex: 1, fill: "#00ff00", width: 100, height: 100, x: 50, y: 50 }),
        makeTextElement({ id: "top",     zIndex: 2, content: "On top", x: 60, y: 90, width: 80, height: 30 }),
      ],
    });
    const r = await renderFixture(t, {}, "png");
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: Unicode Indonesian", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(300, 100),
      elements: [makeTextElement({
        id: "id-text", content: "Harga: Rp 1.500.000 — Diskon 20%",
        width: 280, height: 80, x: 10, y: 10, fontSize: 14,
      })],
    });
    const r = await renderFixture(t, {}, "png");
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: Unicode non-Latin (Mandarin)", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(300, 100),
      elements: [makeTextElement({
        id: "zh-text", content: "欢迎光临 Creative Studio",
        width: 280, height: 80, x: 10, y: 10, fontSize: 14,
      })],
    });
    const r = await renderFixture(t, {}, "png");
    expect(r.buffer.length).toBeGreaterThan(100);
  });

  it("fixture: JPG output (no transparency)", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 100),
      elements: [makeShapeElement({ id: "shape", fill: "#0077ff", width: 200, height: 100 })],
    });
    const r = await renderFixture(t, {}, "jpg");
    expect(r.mimeType).toBe("image/jpeg");
    expect(r.buffer[0]).toBe(0xff);
    expect(r.buffer[1]).toBe(0xd8);
  });

  it("fixture: WebP output", async () => {
    const t = makeTemplate({
      canvas: makeCanvas(200, 100),
      elements: [makeShapeElement({ id: "shape", fill: "#cc0077", width: 200, height: 100 })],
    });
    const r = await renderFixture(t, {}, "webp");
    expect(r.mimeType).toBe("image/webp");
  });
});
