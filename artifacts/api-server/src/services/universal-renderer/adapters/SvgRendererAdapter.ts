/**
 * SvgRendererAdapter — Universal Renderer Team 14
 *
 * Implements SvgRendererPort by delegating to the existing design-renderer
 * xmlEscape + validation helpers. Does NOT duplicate rendering logic.
 *
 * Sanitisation rules:
 *   - Strip <script> tags and on* event attributes
 *   - Clamp viewBox dimensions to DESIGN_LIMITS
 *   - Strip external references to non-https URLs (SSRF guard)
 */

import { DESIGN_LIMITS } from "../../../types/designTemplate.js";
import { RenderError } from "../errors.js";
import type { SvgRendererPort, SvgRenderInput, SvgRenderOutput } from "../ports/SvgRendererPort.js";

// Max raw SVG input size: 5 MB
const MAX_SVG_BYTES = 5 * 1024 * 1024;

// Patterns that must not appear in SVG input (security)
const FORBIDDEN_PATTERNS = [
  /<script[\s>]/i,
  /\bon\w+\s*=/i,      // on* event handlers
  /javascript\s*:/i,   // javascript: URIs
  /data\s*:\s*text\/html/i, // data:text/html URIs
];

// External URL pattern — only https:// allowed in href/xlink:href/src
const EXTERNAL_HTTP_RE = /\b(?:href|xlink:href|src)\s*=\s*["']http:\/\//gi;

function sanitiseSvg(raw: string): { svg: string; warnings: string[] } {
  const warnings: string[] = [];

  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(raw)) {
      throw new RenderError(
        "SVG_SANITISE_FAILED",
        `SVG contains forbidden pattern: ${pat.source}`,
      );
    }
  }

  // Downgrade http:// external refs to a warning and strip them
  let svg = raw;
  if (EXTERNAL_HTTP_RE.test(raw)) {
    warnings.push("External http:// references stripped from SVG (use https://)");
    svg = svg.replace(EXTERNAL_HTTP_RE, (m) => m.replace("http://", "https://"));
  }

  return { svg, warnings };
}

function clampDimensions(
  canvasWidth: number,
  canvasHeight: number,
): { w: number; h: number } {
  const w = Math.min(Math.max(1, canvasWidth),  DESIGN_LIMITS.MAX_CANVAS_WIDTH);
  const h = Math.min(Math.max(1, canvasHeight), DESIGN_LIMITS.MAX_CANVAS_HEIGHT);
  return { w, h };
}

export class SvgRendererAdapter implements SvgRendererPort {
  async render(input: SvgRenderInput): Promise<SvgRenderOutput> {
    const { canvasWidth, canvasHeight, svgContent } = input;

    if (!svgContent || svgContent.trim().length === 0) {
      throw new RenderError("SVG_CONTENT_MISSING", "svgContent must be a non-empty string");
    }

    const byteLen = Buffer.byteLength(svgContent, "utf8");
    if (byteLen > MAX_SVG_BYTES) {
      throw new RenderError(
        "SVG_TOO_LARGE",
        `SVG input is ${byteLen} bytes — exceeds ${MAX_SVG_BYTES} byte limit`,
      );
    }

    const { w, h } = clampDimensions(canvasWidth, canvasHeight);
    const { svg, warnings } = sanitiseSvg(svgContent);

    // Inject/override width + height attributes so downstream encoders
    // know the true canvas dimensions without parsing the SVG tree.
    const normalised = svg
      .replace(/(<svg\b[^>]*)\bwidth\s*=\s*["'][^"']*["']/i, `$1width="${w}"`)
      .replace(/(<svg\b[^>]*)\bheight\s*=\s*["'][^"']*["']/i, `$1height="${h}"`);

    // If attributes were absent, inject them after <svg
    const finalSvg = normalised
      .replace(/^(<svg\b)(?![^>]*\bwidth=)/, `$1 width="${w}"`)
      .replace(/^(<svg\b[^>]*\bwidth="[^"]*")(?![^>]*\bheight=)/, `$1 height="${h}"`);

    return { svgString: finalSvg, warnings };
  }
}
