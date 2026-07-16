/**
 * PngRendererAdapter — Universal Renderer Team 14
 *
 * Implements PngRendererPort by delegating to the existing design-renderer
 * outputEncoder (Sharp-based). Does NOT duplicate encoding logic.
 */

import { createHash } from "crypto";
import { encodeSvg } from "../../design-renderer/outputEncoder.js";
import { RenderError } from "../errors.js";
import type { PngRendererPort, PngRenderInput, PngRenderOutput, RasterFormat } from "../ports/PngRendererPort.js";
import sharp from "sharp";

// 30 MB limit
const MAX_PNG_BYTES = 30 * 1024 * 1024;

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function toDesignFormat(fmt: RasterFormat): "png" | "jpg" | "webp" {
  return fmt; // types align
}

export class PngRendererAdapter implements PngRendererPort {
  async render(input: PngRenderInput): Promise<PngRenderOutput> {
    const format: RasterFormat = input.format ?? "png";
    let result: { buffer: Buffer; mimeType: string; width: number; height: number; fileSizeBytes: number };

    if (input.source.kind === "svg") {
      const encoded = await encodeSvg(
        input.source.svgString,
        toDesignFormat(format),
        input.source.canvasWidth,
        input.source.canvasHeight,
        {
          outputWidth:  input.outputWidth,
          outputHeight: input.outputHeight,
          jpegQuality:  input.quality,
          webpQuality:  input.quality,
        },
      );
      result = {
        buffer:        encoded.buffer,
        mimeType:      encoded.mimeType,
        width:         encoded.width,
        height:        encoded.height,
        fileSizeBytes: encoded.fileSizeBytes,
      };

    } else {
      // Re-encode an existing buffer via Sharp
      const src = sharp(input.source.buffer);
      const meta = await src.metadata();

      let pipeline = src;
      if (input.outputWidth || input.outputHeight) {
        pipeline = pipeline.resize(input.outputWidth, input.outputHeight, { fit: "fill" }) as typeof src;
      }

      let buf: Buffer;
      let mimeType: string;

      if (format === "jpg") {
        buf = await pipeline.jpeg({ quality: input.quality ?? 88 }).toBuffer();
        mimeType = "image/jpeg";
      } else if (format === "webp") {
        buf = await pipeline.webp({ quality: input.quality ?? 88 }).toBuffer();
        mimeType = "image/webp";
      } else {
        buf = await pipeline.png({ compressionLevel: 6 }).toBuffer();
        mimeType = "image/png";
      }

      const finalMeta = await sharp(buf).metadata();
      result = {
        buffer:        buf,
        mimeType,
        width:         finalMeta.width  ?? meta.width  ?? 0,
        height:        finalMeta.height ?? meta.height ?? 0,
        fileSizeBytes: buf.length,
      };
    }

    if (result.fileSizeBytes > MAX_PNG_BYTES) {
      throw new RenderError(
        "PNG_TOO_LARGE",
        `Raster output is ${result.fileSizeBytes} bytes — exceeds ${MAX_PNG_BYTES} byte limit`,
      );
    }

    return {
      ...result,
      checksum: sha256(result.buffer),
    };
  }
}
