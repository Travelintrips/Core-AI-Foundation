/**
 * thumbnailService — Universal Renderer Team 14
 *
 * Generates 16:9 WebP thumbnails.
 *
 * P1 DUPLICATION fix:
 *   SVG → WebP now delegates to encodeSvg() from the existing design-renderer
 *   (services/design-renderer/outputEncoder.ts) instead of duplicating the
 *   Sharp pipeline. Buffer → WebP re-encode still uses Sharp directly since
 *   encodeSvg() only accepts SVG source.
 */

import sharp from "sharp";
import { encodeSvg } from "../design-renderer/outputEncoder.js";
import { computeChecksum } from "./checksumService.js";
import { RenderError } from "./errors.js";

const THUMB_W = 1280;
const THUMB_H = 720;

export interface ThumbnailInput {
  /** SVG string OR an existing PNG/WebP buffer to resize. */
  source:
    | { kind: "svg"; svgString: string; canvasWidth: number; canvasHeight: number }
    | { kind: "buffer"; buffer: Buffer };
  /** Override output dimensions. Default 1280×720 (16:9). */
  width?: number;
  height?: number;
}

export interface ThumbnailOutput {
  buffer: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
  fileSizeBytes: number;
  checksum: string;
}

export async function generateThumbnail(input: ThumbnailInput): Promise<ThumbnailOutput> {
  const outW = input.width  ?? THUMB_W;
  const outH = input.height ?? THUMB_H;

  let buf: Buffer;

  if (input.source.kind === "svg") {
    // ── Delegate to design-renderer encodeSvg (reuse, no duplication) ───────
    try {
      const result = await encodeSvg(
        input.source.svgString,
        "webp",
        input.source.canvasWidth,
        input.source.canvasHeight,
        { outputWidth: outW, outputHeight: outH },
      );
      buf = result.buffer;
    } catch (err) {
      if (err instanceof RenderError) throw err;
      throw new RenderError(
        "SHARP_RENDER_FAILED",
        `Thumbnail generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    // ── Buffer source — re-encode via Sharp (no design-renderer equivalent) ─
    try {
      buf = await sharp(input.source.buffer)
        .resize(outW, outH, { fit: "cover", position: "centre" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (err) {
      throw new RenderError(
        "SHARP_RENDER_FAILED",
        `Thumbnail re-encode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    buffer:        buf,
    mimeType:      "image/webp",
    width:         outW,
    height:        outH,
    fileSizeBytes: buf.length,
    checksum:      computeChecksum(buf),
  };
}
