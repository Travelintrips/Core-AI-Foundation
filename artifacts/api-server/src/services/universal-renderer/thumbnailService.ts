/**
 * thumbnailService — Universal Renderer Team 14
 *
 * Generates 16:9 WebP thumbnails from SVG content.
 * Reuses the existing Sharp pipeline from presentationThumbnailService
 * rather than duplicating it.
 */

import sharp from "sharp";
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

  let pipeline: ReturnType<typeof sharp>;

  if (input.source.kind === "svg") {
    const svgBuf = Buffer.from(input.source.svgString, "utf8");
    pipeline = sharp(svgBuf, { density: 72 });
  } else {
    pipeline = sharp(input.source.buffer);
  }

  let buf: Buffer;
  try {
    buf = await pipeline
      .resize(outW, outH, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err) {
    throw new RenderError(
      "SHARP_RENDER_FAILED",
      `Thumbnail generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
