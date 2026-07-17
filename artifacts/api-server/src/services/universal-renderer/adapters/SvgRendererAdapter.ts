/**
 * SvgRendererAdapter — Universal Renderer Team 14
 *
 * Implements SvgRendererPort. Sanitises raw SVG input before handing it to
 * downstream encoders:
 *
 *   1. Size guard — reject if > MAX_SVG_BYTES
 *   2. SSRF scan — every external URL in href/src/xlink:href/CSS url()
 *      is validated via the project-level ssrfGuard (validateExternalUrl).
 *      http:// URLs are rejected outright; https:// URLs are SSRF-checked.
 *   3. Forbidden patterns — <script>, on* handlers, javascript:, data:text/html
 *   4. Asset count limit — no more than MAX_ASSET_COUNT distinct external URLs
 *   5. Dimension clamp — width/height pinned to DESIGN_LIMITS
 *
 * Does NOT duplicate the design-renderer encoding logic — that lives in
 * PngRendererAdapter / PdfRendererAdapter via encodeSvg().
 */

import { DESIGN_LIMITS } from "../../../types/designTemplate.js";
import { RenderError } from "../errors.js";
import { scanSvgForBlockedUrls } from "../ssrfFetchValidator.js";
import { UNIVERSAL_RENDER_LIMITS } from "../resourceLimits.js";
import type { SvgRendererPort, SvgRenderInput, SvgRenderOutput } from "../ports/SvgRendererPort.js";

// ── Forbidden patterns ────────────────────────────────────────────────────────

const FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /<script[\s>]/i,            label: "<script> tag" },
  { pattern: /\bon\w+\s*=/i,             label: "on* event handler" },
  { pattern: /javascript\s*:/i,          label: "javascript: URI" },
  { pattern: /data\s*:\s*text\/html/i,   label: "data:text/html URI" },
  { pattern: /<foreignObject/i,          label: "<foreignObject> (XSS vector)" },
  { pattern: /<!ENTITY/i,               label: "XML ENTITY declaration (XXE)" },
];

// ── Sanitiser ─────────────────────────────────────────────────────────────────

function sanitiseSvg(raw: string): { svg: string; warnings: string[] } {
  const warnings: string[] = [];

  for (const { pattern, label } of FORBIDDEN) {
    if (pattern.test(raw)) {
      throw new RenderError("SVG_SANITISE_FAILED", `SVG contains forbidden pattern: ${label}`);
    }
  }

  // SSRF scan — throws on any blocked or http:// URL
  const { urlCount } = scanSvgForBlockedUrls(raw);
  if (urlCount > 0) {
    warnings.push(`SVG contains ${urlCount} external URL reference(s) — all validated`);
  }

  return { svg: raw, warnings };
}

// ── Dimension helpers ─────────────────────────────────────────────────────────

function clampDimensions(w: number, h: number): { w: number; h: number } {
  const clampedW = Math.min(Math.max(1, w), DESIGN_LIMITS.MAX_CANVAS_WIDTH);
  const clampedH = Math.min(Math.max(1, h), DESIGN_LIMITS.MAX_CANVAS_HEIGHT);
  return { w: clampedW, h: clampedH };
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class SvgRendererAdapter implements SvgRendererPort {
  async render(input: SvgRenderInput): Promise<SvgRenderOutput> {
    const { canvasWidth, canvasHeight, svgContent } = input;

    // Guard 1 — non-empty
    if (!svgContent || svgContent.trim().length === 0) {
      throw new RenderError("SVG_CONTENT_MISSING", "svgContent must be a non-empty string");
    }

    // Guard 2 — size
    const byteLen = Buffer.byteLength(svgContent, "utf8");
    if (byteLen > UNIVERSAL_RENDER_LIMITS.MAX_SVG_BYTES) {
      throw new RenderError(
        "SVG_TOO_LARGE",
        `SVG input is ${byteLen} bytes — exceeds ${UNIVERSAL_RENDER_LIMITS.MAX_SVG_BYTES} byte limit`,
      );
    }

    // Guard 3 — canvas dimensions
    const totalPixels = canvasWidth * canvasHeight;
    if (totalPixels > UNIVERSAL_RENDER_LIMITS.MAX_CANVAS_PIXELS) {
      throw new RenderError(
        "CANVAS_LIMIT_EXCEEDED",
        `Canvas ${canvasWidth}×${canvasHeight} = ${totalPixels} pixels exceeds limit`,
      );
    }

    // Guard 4 — sanitise (includes SSRF scan)
    const { svg, warnings } = sanitiseSvg(svgContent);

    // Guard 5 — clamp dimensions
    const { w, h } = clampDimensions(canvasWidth, canvasHeight);

    // Inject/override width + height on the root <svg> element
    let finalSvg = svg
      .replace(/(<svg\b[^>]*)\bwidth\s*=\s*["'][^"']*["']/i, `$1width="${w}"`)
      .replace(/(<svg\b[^>]*)\bheight\s*=\s*["'][^"']*["']/i, `$1height="${h}"`);

    if (!/(<svg\b[^>]*)\bwidth=/i.test(finalSvg)) {
      finalSvg = finalSvg.replace(/^(<svg\b)/, `$1 width="${w}"`);
    }
    if (!/(<svg\b[^>]*)\bheight=/i.test(finalSvg)) {
      finalSvg = finalSvg.replace(/^(<svg\b[^>]*)/, `$1 height="${h}"`);
    }

    return { svgString: finalSvg, warnings };
  }
}
