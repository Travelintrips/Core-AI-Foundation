/**
 * presentationThumbnailService.ts — Phase 4 Presentation Engine
 *
 * Generates a 16:9 cover thumbnail (WebP) directly from the same source
 * slide spec used for the PPTX and PDF preview — never a screenshot of an
 * untrusted public URL, and never dependent on a PPTX rasterizer that this
 * environment does not have.
 */

import sharp from "sharp";
import type { CreativePresentationSpec } from "./presentationTypes.js";

export class PresentationThumbnailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresentationThumbnailError";
  }
}

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: "image/webp";
}

const THUMB_W = 1280;
const THUMB_H = 720;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render the cover slide (title + subtitle + company name) as an SVG, then
 * rasterize it with sharp to a WebP thumbnail. Deterministic and dependency-light.
 */
export async function generatePresentationThumbnail(
  spec: CreativePresentationSpec,
): Promise<ThumbnailResult> {
  const cover = spec.slides.find((s) => s.kind === "cover") ?? spec.slides[0];
  const title = esc((cover?.title ?? spec.title).slice(0, 90));
  const subtitle = esc((cover?.subtitle ?? spec.subtitle ?? "").slice(0, 120));
  const company = esc((spec.companyName ?? "").slice(0, 60));
  const theme = spec.theme;

  const svg = `
<svg width="${THUMB_W}" height="${THUMB_H}" viewBox="0 0 ${THUMB_W} ${THUMB_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${THUMB_W}" height="${THUMB_H}" fill="${theme.primaryColor}" />
  <rect x="0" y="0" width="10" height="${THUMB_H}" fill="${theme.accentColor}" />
  ${company ? `<text x="90" y="120" font-family="sans-serif" font-size="28" fill="${theme.backgroundColor}" opacity="0.85">${company}</text>` : ""}
  <text x="90" y="${subtitle ? 320 : 380}" font-family="sans-serif" font-size="56" font-weight="bold" fill="${theme.backgroundColor}">
    ${title}
  </text>
  ${subtitle ? `<text x="90" y="390" font-family="sans-serif" font-size="26" fill="${theme.backgroundColor}" opacity="0.85">${subtitle}</text>` : ""}
</svg>`.trim();

  let buffer: Buffer;
  try {
    buffer = await sharp(Buffer.from(svg)).resize(THUMB_W, THUMB_H).webp({ quality: 82 }).toBuffer();
  } catch (err) {
    throw new PresentationThumbnailError(`Thumbnail render failed: ${String(err)}`);
  }

  if (!buffer || buffer.length === 0) {
    throw new PresentationThumbnailError("Thumbnail buffer is empty");
  }

  return { buffer, width: THUMB_W, height: THUMB_H, mimeType: "image/webp" };
}
