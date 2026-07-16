/**
 * Design Renderer — Output Encoder (Sharp)
 *
 * Takes a finalized SVG string and encodes it to the requested format.
 * All output goes through Sharp — no browser, no headless rendering.
 */

import sharp from "sharp";
import { RenderError } from "./errors.js";
import { renderConfig } from "./config.js";
import type { RenderFormat } from "../../types/designTemplate.js";
import { DESIGN_LIMITS } from "../../types/designTemplate.js";
import { pngToPdf } from "./pdfRenderer.js";

export type EncodeResult = {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
};

/**
 * Validate requested output dimensions against safety limits.
 * Throws CANVAS_LIMIT_EXCEEDED if the dimensions are unsafe.
 */
export function validateOutputDimensions(
  canvasWidth: number,
  canvasHeight: number,
  outputWidth?: number,
  outputHeight?: number,
): { finalWidth: number; finalHeight: number } {
  const w = outputWidth  ?? canvasWidth;
  const h = outputHeight ?? canvasHeight;

  if (w < 1 || h < 1) {
    throw new RenderError("CANVAS_LIMIT_EXCEEDED", "Output dimensions must be at least 1×1 px");
  }
  if (w > DESIGN_LIMITS.MAX_CANVAS_WIDTH || h > DESIGN_LIMITS.MAX_CANVAS_HEIGHT) {
    throw new RenderError("CANVAS_LIMIT_EXCEEDED", `Output ${w}×${h} exceeds max ${DESIGN_LIMITS.MAX_CANVAS_WIDTH}×${DESIGN_LIMITS.MAX_CANVAS_HEIGHT}`);
  }
  // Guard against memory exhaustion
  const totalPixels = w * h;
  const maxPixels   = DESIGN_LIMITS.MAX_CANVAS_WIDTH * DESIGN_LIMITS.MAX_CANVAS_HEIGHT;
  if (totalPixels > maxPixels) {
    throw new RenderError("CANVAS_LIMIT_EXCEEDED", `Total pixels ${totalPixels} exceeds limit ${maxPixels}`);
  }

  return { finalWidth: w, finalHeight: h };
}

/**
 * Render SVG → PNG buffer via Sharp/librsvg.
 */
async function renderToPng(
  svgString: string,
  canvasWidth: number,
  canvasHeight: number,
  outputWidth?: number,
  outputHeight?: number,
): Promise<Buffer> {
  try {
    const svgBuffer = Buffer.from(svgString, "utf8");
    let pipeline = sharp(svgBuffer, { density: 72 });

    const { finalWidth, finalHeight } = validateOutputDimensions(canvasWidth, canvasHeight, outputWidth, outputHeight);

    // Only resize if output dimensions differ from canvas
    if (finalWidth !== canvasWidth || finalHeight !== canvasHeight) {
      pipeline = pipeline.resize(finalWidth, finalHeight, { fit: "fill" });
    }

    return await pipeline.png({ compressionLevel: 6 }).toBuffer();
  } catch (err) {
    if (err instanceof RenderError) throw err;
    throw new RenderError(
      "SHARP_RENDER_FAILED",
      `Sharp PNG render failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Encode SVG to the requested format.
 * PDF strategy: render to PNG first, then embed in pdf-lib (Strategy A).
 */
export async function encodeSvg(
  svgString: string,
  format: RenderFormat,
  canvasWidth: number,
  canvasHeight: number,
  opts?: {
    outputWidth?: number;
    outputHeight?: number;
    jpegQuality?: number;
    webpQuality?: number;
    pdfMetadata?: { title?: string; creator?: string; rendererVersion?: string };
  },
): Promise<EncodeResult> {
  const jpegQuality = opts?.jpegQuality ?? renderConfig.jpegQuality;
  const webpQuality = opts?.webpQuality ?? renderConfig.webpQuality;

  if (format === "png") {
    const pngBuf = await renderToPng(svgString, canvasWidth, canvasHeight, opts?.outputWidth, opts?.outputHeight);
    const meta   = await sharp(pngBuf).metadata();
    return {
      buffer:        pngBuf,
      mimeType:      "image/png",
      width:         meta.width  ?? (opts?.outputWidth  ?? canvasWidth),
      height:        meta.height ?? (opts?.outputHeight ?? canvasHeight),
      fileSizeBytes: pngBuf.length,
    };
  }

  if (format === "jpg") {
    try {
      const svgBuffer = Buffer.from(svgString, "utf8");
      const { finalWidth, finalHeight } = validateOutputDimensions(canvasWidth, canvasHeight, opts?.outputWidth, opts?.outputHeight);
      let pipeline = sharp(svgBuffer, { density: 72 });
      if (finalWidth !== canvasWidth || finalHeight !== canvasHeight) {
        pipeline = pipeline.resize(finalWidth, finalHeight, { fit: "fill" });
      }
      // Flatten transparency (JPEG doesn't support alpha)
      const jpgBuf = await pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: Math.max(1, Math.min(100, jpegQuality)) })
        .toBuffer();
      const meta   = await sharp(jpgBuf).metadata();
      return {
        buffer:        jpgBuf,
        mimeType:      "image/jpeg",
        width:         meta.width  ?? finalWidth,
        height:        meta.height ?? finalHeight,
        fileSizeBytes: jpgBuf.length,
      };
    } catch (err) {
      if (err instanceof RenderError) throw err;
      throw new RenderError("SHARP_RENDER_FAILED", `Sharp JPEG render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (format === "webp") {
    try {
      const svgBuffer = Buffer.from(svgString, "utf8");
      const { finalWidth, finalHeight } = validateOutputDimensions(canvasWidth, canvasHeight, opts?.outputWidth, opts?.outputHeight);
      let pipeline = sharp(svgBuffer, { density: 72 });
      if (finalWidth !== canvasWidth || finalHeight !== canvasHeight) {
        pipeline = pipeline.resize(finalWidth, finalHeight, { fit: "fill" });
      }
      const webpBuf = await pipeline
        .webp({ quality: Math.max(1, Math.min(100, webpQuality)) })
        .toBuffer();
      const meta    = await sharp(webpBuf).metadata();
      return {
        buffer:        webpBuf,
        mimeType:      "image/webp",
        width:         meta.width  ?? finalWidth,
        height:        meta.height ?? finalHeight,
        fileSizeBytes: webpBuf.length,
      };
    } catch (err) {
      if (err instanceof RenderError) throw err;
      throw new RenderError("SHARP_RENDER_FAILED", `Sharp WebP render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (format === "pdf") {
    // Strategy A: render to PNG, embed in pdf-lib
    const pngBuf = await renderToPng(svgString, canvasWidth, canvasHeight, opts?.outputWidth, opts?.outputHeight);
    const meta   = await sharp(pngBuf).metadata();
    const finalW = meta.width  ?? (opts?.outputWidth  ?? canvasWidth);
    const finalH = meta.height ?? (opts?.outputHeight ?? canvasHeight);

    const pdfBuf = await pngToPdf(pngBuf, finalW, finalH, opts?.pdfMetadata);
    return {
      buffer:        pdfBuf,
      mimeType:      "application/pdf",
      width:         finalW,
      height:        finalH,
      fileSizeBytes: pdfBuf.length,
    };
  }

  throw new RenderError("SHARP_RENDER_FAILED", `Unsupported output format: ${format}`);
}

/** Derive the MIME type string for a given render format. */
export function mimeForFormat(format: RenderFormat): string {
  switch (format) {
    case "png":  return "image/png";
    case "jpg":  return "image/jpeg";
    case "webp": return "image/webp";
    case "pdf":  return "application/pdf";
  }
}

/** Derive the file extension for a given render format. */
export function extForFormat(format: RenderFormat): string {
  return format;
}
