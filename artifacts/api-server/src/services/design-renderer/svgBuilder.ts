/**
 * Design Renderer — SVG Intermediate Representation Builder
 *
 * Assembles a complete, self-contained SVG string from a DesignTemplate and
 * pre-resolved assets. The SVG is safe for Sharp/librsvg rendering:
 *  - Explicit width, height, viewBox
 *  - No scripts, event handlers, foreignObject, or external resources
 *  - All images embedded as data URIs
 *  - All text content XML-escaped
 */

import type { DesignTemplate, DesignElement } from "../../types/designTemplate.js";
import { DESIGN_LIMITS } from "../../types/designTemplate.js";
import { RenderError } from "./errors.js";
import { WarningAccumulator } from "./renderWarnings.js";
import { renderElement, xmlEscape } from "./elementRenderer.js";
import { resolveAssetReference } from "./imageResolver.js";
import { resolveTextContent } from "../designTemplateVariableService.js";
import type { AssetReference } from "../../types/designTemplate.js";
import type { RenderDataRow } from "../../types/designTemplate.js";
import { AssetCache } from "./assetCache.js";

export type SvgBuildOptions = {
  /** Override canvas size (for output scaling — layout still uses template coords) */
  outputWidth?: number;
  outputHeight?: number;
  cache?: AssetCache;
};

/**
 * Build the complete SVG string for a template + data row.
 * Returns the SVG string and collected warnings.
 */
export async function buildSvg(
  template: DesignTemplate,
  data: RenderDataRow,
  warnings: WarningAccumulator,
  opts: SvgBuildOptions = {},
): Promise<string> {
  const canvas = template.canvas;
  const canvasW = canvas.width;
  const canvasH = canvas.height;

  // Validate canvas limits
  if (canvasW > DESIGN_LIMITS.MAX_CANVAS_WIDTH || canvasH > DESIGN_LIMITS.MAX_CANVAS_HEIGHT) {
    throw new RenderError("CANVAS_LIMIT_EXCEEDED", `Canvas ${canvasW}×${canvasH} exceeds limits`);
  }

  const cache = opts.cache ?? new AssetCache();

  // ── Phase 1: Resolve all assets referenced in elements ─────────────────────
  // Key: elementId → resolved data URI (images) or resolved string (text, qr)
  const resolvedImages = new Map<string, string | null>();

  const sortedElements = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);

  for (const el of sortedElements) {
    if (el.type === "image") {
      // Resolve image src
      const src = el.src;
      if (!src) {
        // no src — check placeholder
        if (el.placeholder) {
          try {
            const resolved = await resolveAssetReference(el.placeholder, cache);
            resolvedImages.set(el.id, resolved.dataUri);
          } catch {
            resolvedImages.set(el.id, null);
            warnings.add(el.id, "IMAGE_FALLBACK_USED", "Placeholder failed to load");
          }
        } else {
          resolvedImages.set(el.id, null);
        }
        continue;
      }

      let assetRef: AssetReference | null = null;
      if (typeof src === "object" && "binding" in src) {
        // Variable-bound image: the variable value should be a URL or storage path
        const { value, missing } = resolveTextContent(src, data);
        if (missing || !value) {
          // Try placeholder
          if (el.placeholder) {
            try {
              const resolved = await resolveAssetReference(el.placeholder, cache);
              resolvedImages.set(el.id, resolved.dataUri);
              warnings.add(el.id, "IMAGE_FALLBACK_USED", "Variable missing — using placeholder");
            } catch {
              resolvedImages.set(el.id, null);
              warnings.add(el.id, "IMAGE_FALLBACK_USED", "Variable missing and placeholder failed");
            }
          } else {
            resolvedImages.set(el.id, null);
            warnings.add(el.id, "OPTIONAL_VARIABLE_MISSING", `Image variable "${src.binding.variableKey}" missing`);
          }
          continue;
        }
        // Treat the resolved value as a URL
        assetRef = { type: "url", url: value };
      } else {
        assetRef = src as AssetReference;
      }

      try {
        const resolved = await resolveAssetReference(assetRef, cache);
        resolvedImages.set(el.id, resolved.dataUri);
      } catch (err) {
        // Try placeholder on error
        if (el.placeholder) {
          try {
            const fallback = await resolveAssetReference(el.placeholder, cache);
            resolvedImages.set(el.id, fallback.dataUri);
            warnings.add(el.id, "IMAGE_FALLBACK_USED", `Primary image failed, using placeholder: ${err instanceof Error ? err.message : String(err)}`);
          } catch {
            resolvedImages.set(el.id, null);
            warnings.add(el.id, "IMAGE_FALLBACK_USED", "Both primary and placeholder failed");
          }
        } else {
          resolvedImages.set(el.id, null);
          warnings.add(el.id, "IMAGE_FALLBACK_USED", `Image failed to load: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else if (el.type === "text") {
      // Resolve text content (variable binding)
      if (typeof el.content !== "string") {
        const { value, missing } = resolveTextContent(el.content, data);
        resolvedImages.set(`__text__${el.id}`, value);
        if (missing) warnings.add(el.id, "VARIABLE_FALLBACK_USED", `Variable "${el.content.binding.variableKey}" missing — using fallback`);
      }
    } else if (el.type === "qrcode") {
      // Resolve QR content
      if (typeof el.content !== "string") {
        const { value, missing } = resolveTextContent(el.content, data);
        resolvedImages.set(`__qr__${el.id}`, value);
        if (missing) warnings.add(el.id, "VARIABLE_FALLBACK_USED", `QR variable "${el.content.binding.variableKey}" missing`);
      } else {
        resolvedImages.set(`__qr__${el.id}`, el.content);
      }
    }
  }

  // ── Phase 2: Resolve background image ──────────────────────────────────────
  let backgroundImageUri: string | null = null;
  if (canvas.backgroundImage) {
    try {
      const bg = await resolveAssetReference(canvas.backgroundImage, cache);
      backgroundImageUri = bg.dataUri;
    } catch {
      warnings.add("canvas", "IMAGE_FALLBACK_USED", "Background image failed to load");
    }
  }

  // ── Phase 3: Build SVG ─────────────────────────────────────────────────────
  const defs: string[] = [];
  const elementSvgs: string[] = [];

  for (const el of sortedElements) {
    // Evaluate conditional visibility
    if (el.visibleWhen) {
      const { evaluateVisibility } = await import("../designTemplateVariableService.js");
      const visible = evaluateVisibility(el.visibleWhen, data);
      if (!visible) continue;
    }

    // Check element is within canvas bounds (warn, don't skip)
    if (el.x + el.width < 0 || el.y + el.height < 0 || el.x > canvasW || el.y > canvasH) {
      warnings.add(el.id, "ELEMENT_OUTSIDE_CANVAS", `Element at (${el.x},${el.y}) is outside canvas bounds`);
    }

    try {
      const svg = await renderElement(el, resolvedImages, warnings, defs);
      elementSvgs.push(svg);
    } catch (err) {
      // Non-fatal element errors: log warning and skip element
      warnings.add(
        (el as any).id ?? "unknown",
        "ELEMENT_SKIPPED",
        `Element render error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Phase 4: Assemble SVG ──────────────────────────────────────────────────
  const bgColor = xmlEscape(canvas.backgroundColor ?? "#ffffff");
  const bgRect = `<rect width="${canvasW}" height="${canvasH}" fill="${bgColor}"/>`;
  const bgImage = backgroundImageUri
    ? `<image x="0" y="0" width="${canvasW}" height="${canvasH}" href="${xmlEscape(backgroundImageUri)}" preserveAspectRatio="xMidYMid slice"/>`
    : "";

  const defsBlock = defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">${defsBlock}${bgRect}${bgImage}${elementSvgs.join("")}</svg>`;

  return svg;
}
