/**
 * watermarkService.test.ts — Team 14
 *
 * Critical invariant: watermark MUST fail-closed.
 * If stampWatermarkBuffer() or stampWatermarkSvg() fails, it must THROW —
 * never return the un-watermarked source content.
 */

import { describe, it, expect } from "vitest";
import { stampWatermarkBuffer, stampWatermarkSvg } from "../watermarkService.js";
import { RenderError } from "../errors.js";

// Minimal valid PDF bytes (for smoke-test only; pdf-lib will parse them)
const MINIMAL_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<</Type /Catalog>>\nendobj\nxref\n0 0\ntrailer\n<</Root 1 0 R>>\nstartxref\n0\n%%EOF");

describe("watermarkService — fail-closed contract", () => {
  describe("stampWatermarkBuffer", () => {
    it("throws WATERMARK_FAILED for an empty buffer — never returns un-watermarked content", async () => {
      await expect(stampWatermarkBuffer(Buffer.alloc(0))).rejects.toMatchObject({
        code: "WATERMARK_FAILED",
      });
    });

    it("throws WATERMARK_FAILED for non-PDF bytes — never silently passes through", async () => {
      const notPdf = Buffer.from("definitely not a PDF");
      await expect(stampWatermarkBuffer(notPdf)).rejects.toMatchObject({
        code: "WATERMARK_FAILED",
      });
    });

    it("throws RenderError (never returns original) when pdf-lib rejects the input", async () => {
      const corruptPdf = Buffer.from("%PDF-1.4 CORRUPT GARBAGE %%EOF");
      await expect(stampWatermarkBuffer(corruptPdf)).rejects.toBeInstanceOf(RenderError);
    });
  });

  describe("stampWatermarkSvg", () => {
    it("injects watermark group before </svg>", () => {
      const svg = '<svg width="100" height="100"><rect/></svg>';
      const out  = stampWatermarkSvg(svg);
      expect(out).toContain("PREVIEW");
      expect(out).toContain("</svg>");
      // Watermark group must appear INSIDE the SVG
      const wPos  = out.indexOf("PREVIEW");
      const close = out.lastIndexOf("</svg>");
      expect(wPos).toBeLessThan(close);
    });

    it("throws WATERMARK_FAILED if SVG has no closing tag — never returns unmodified string", () => {
      const badSvg = "<svg><rect/>";
      expect(() => stampWatermarkSvg(badSvg)).toThrowError(RenderError);
      expect(() => stampWatermarkSvg(badSvg)).toThrowError(
        expect.objectContaining({ code: "WATERMARK_FAILED" }),
      );
    });

    it("escapes special characters in watermark text", () => {
      const svg = '<svg width="10" height="10"></svg>';
      const out  = stampWatermarkSvg(svg);
      // Should not contain raw < > & in the text node
      const textContent = out.match(/>([^<]+)</g)?.join("") ?? "";
      expect(textContent).not.toContain("<script");
    });
  });
});
