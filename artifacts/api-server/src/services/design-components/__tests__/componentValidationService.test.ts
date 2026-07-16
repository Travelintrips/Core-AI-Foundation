/**
 * Team 8 — Component Validation Service Tests
 */

import { describe, it, expect } from "vitest";
import {
  validateComponentInstance,
  validatePartialComponentInstance,
  applyDefaults,
} from "../componentValidationService.js";

describe("validateComponentInstance", () => {
  describe("unknown type", () => {
    it("rejects unknown component type", () => {
      const result = validateComponentInstance({
        type: "nonexistent" as any,
        domain: "graphic",
        fieldValues: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]!.field).toBe("type");
    });
  });

  describe("domain compatibility", () => {
    it("rejects chart in interior domain", () => {
      const result = validateComponentInstance({
        type: "chart",
        domain: "interior",
        fieldValues: { chartType: "bar", data: [] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "domain")).toBe(true);
    });

    it("accepts logo in fashion domain (cross-domain supported)", () => {
      const result = validateComponentInstance({
        type: "logo",
        domain: "fashion",
        fieldValues: {
          imageUrl: "https://example.com/logo.png",
          width: 50,
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("graphic / text", () => {
    it("passes with valid content", () => {
      const result = validateComponentInstance({
        type: "text",
        domain: "graphic",
        fieldValues: {
          content: "Hello World",
          fontFamily: "Inter",
          fontSize: 14,
          color: "#333333",
          alignment: "left",
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when content is missing (required field)", () => {
      const result = validateComponentInstance({
        type: "text",
        domain: "graphic",
        fieldValues: { fontSize: 14 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "content")).toBe(true);
    });

    it("fails when fontWeight is not a valid enum", () => {
      const result = validateComponentInstance({
        type: "text",
        domain: "graphic",
        fieldValues: { content: "Hello", fontWeight: "ultra-heavy" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "fontWeight")).toBe(true);
    });

    it("fails when fontSize is below minimum", () => {
      const result = validateComponentInstance({
        type: "text",
        domain: "graphic",
        fieldValues: { content: "Hi", fontSize: 1 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "fontSize")).toBe(true);
    });

    it("fails with invalid color hex", () => {
      const result = validateComponentInstance({
        type: "text",
        domain: "graphic",
        fieldValues: { content: "Hi", color: "red" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "color")).toBe(true);
    });

    it("accepts 6-digit hex color", () => {
      const result = validateComponentInstance({
        type: "text",
        domain: "graphic",
        fieldValues: { content: "Hi", color: "#FF5733" },
      });
      expect(result.valid).toBe(true);
    });

    it("accepts 8-digit hex color (with alpha)", () => {
      const result = validateComponentInstance({
        type: "text",
        domain: "graphic",
        fieldValues: { content: "Hi", color: "#FF573380" },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("graphic / qr", () => {
    it("passes with valid QR data", () => {
      const result = validateComponentInstance({
        type: "qr",
        domain: "graphic",
        fieldValues: { data: "https://example.com", size: 40, errorCorrection: "M" },
      });
      expect(result.valid).toBe(true);
    });

    it("fails when data is missing", () => {
      const result = validateComponentInstance({
        type: "qr",
        domain: "graphic",
        fieldValues: { size: 40 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "data")).toBe(true);
    });

    it("fails with invalid errorCorrection enum", () => {
      const result = validateComponentInstance({
        type: "qr",
        domain: "graphic",
        fieldValues: { data: "test", errorCorrection: "X" },
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("graphic / logo", () => {
    it("fails when imageUrl is not a valid URL", () => {
      const result = validateComponentInstance({
        type: "logo",
        domain: "graphic",
        fieldValues: { imageUrl: "not-a-url", width: 50 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "imageUrl")).toBe(true);
    });

    it("fails when width is too small", () => {
      const result = validateComponentInstance({
        type: "logo",
        domain: "graphic",
        fieldValues: { imageUrl: "https://example.com/logo.png", width: 1 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "width")).toBe(true);
    });
  });

  describe("interior / sofa", () => {
    it("passes with valid sofa definition", () => {
      const result = validateComponentInstance({
        type: "sofa",
        domain: "interior",
        fieldValues: {
          style: "modern",
          width: 2200,
          depth: 900,
          seatingCapacity: 3,
          material: "fabric",
          color: "#8B7355",
        },
      });
      expect(result.valid).toBe(true);
    });

    it("fails when sofa style enum is invalid", () => {
      const result = validateComponentInstance({
        type: "sofa",
        domain: "interior",
        fieldValues: { style: "futuristic", width: 2000, depth: 800 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "style")).toBe(true);
    });

    it("fails when width is below minimum (600mm)", () => {
      const result = validateComponentInstance({
        type: "sofa",
        domain: "interior",
        fieldValues: { style: "modern", width: 100, depth: 800 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "width")).toBe(true);
    });
  });

  describe("fashion / body_panel", () => {
    it("passes with valid body panel", () => {
      const result = validateComponentInstance({
        type: "body_panel",
        domain: "fashion",
        fieldValues: {
          panelSide: "front",
          garmentType: "t-shirt",
          fabricType: "cotton",
          baseColor: "#FFFFFF",
        },
      });
      expect(result.valid).toBe(true);
    });

    it("fails when panelSide enum is invalid", () => {
      const result = validateComponentInstance({
        type: "body_panel",
        domain: "fashion",
        fieldValues: { panelSide: "top", garmentType: "t-shirt" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "panelSide")).toBe(true);
    });

    it("fails when panelSide is missing", () => {
      const result = validateComponentInstance({
        type: "body_panel",
        domain: "fashion",
        fieldValues: { garmentType: "t-shirt" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "panelSide")).toBe(true);
    });
  });

  describe("fashion / name_number", () => {
    it("passes when only playerName is provided", () => {
      const result = validateComponentInstance({
        type: "name_number",
        domain: "fashion",
        fieldValues: { playerName: "Messi" },
      });
      expect(result.valid).toBe(true);
    });

    it("passes when only squadNumber is provided", () => {
      const result = validateComponentInstance({
        type: "name_number",
        domain: "fashion",
        fieldValues: { squadNumber: "10" },
      });
      expect(result.valid).toBe(true);
    });

    it("fails when neither name nor number is provided (custom constraint)", () => {
      const result = validateComponentInstance({
        type: "name_number",
        domain: "fashion",
        fieldValues: {},
      });
      expect(result.valid).toBe(false);
      // The custom constraint should fire
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("packaging / barcode", () => {
    it("passes with valid EAN-13 barcode", () => {
      const result = validateComponentInstance({
        type: "barcode",
        domain: "packaging",
        fieldValues: { barcodeType: "EAN-13", value: "5901234123457", width: 38, height: 25 },
      });
      expect(result.valid).toBe(true);
    });

    it("fails when barcodeType is missing", () => {
      const result = validateComponentInstance({
        type: "barcode",
        domain: "packaging",
        fieldValues: { value: "123456" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "barcodeType")).toBe(true);
    });

    it("fails when value is missing", () => {
      const result = validateComponentInstance({
        type: "barcode",
        domain: "packaging",
        fieldValues: { barcodeType: "QR" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "value")).toBe(true);
    });

    it("rejects barcode in fashion domain", () => {
      const result = validateComponentInstance({
        type: "barcode",
        domain: "fashion",
        fieldValues: { barcodeType: "QR", value: "123" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "domain")).toBe(true);
    });
  });

  describe("packaging / legal_block", () => {
    it("passes with valid legal content", () => {
      const result = validateComponentInstance({
        type: "legal_block",
        domain: "packaging",
        fieldValues: { content: "Mengandung pengawet. Jauhkan dari anak-anak." },
      });
      expect(result.valid).toBe(true);
    });

    it("fails when content is missing", () => {
      const result = validateComponentInstance({
        type: "legal_block",
        domain: "packaging",
        fieldValues: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "content")).toBe(true);
    });
  });

  describe("packaging faces (front/back/side/top/bottom)", () => {
    const faces = ["front", "back", "side", "top", "bottom"] as const;

    for (const face of faces) {
      it(`${face} face passes with dimensions`, () => {
        const result = validateComponentInstance({
          type: face,
          domain: "packaging",
          fieldValues: { width: 100, height: 150 },
        });
        expect(result.valid).toBe(true);
      });

      it(`${face} face fails without dimensions`, () => {
        const result = validateComponentInstance({
          type: face,
          domain: "packaging",
          fieldValues: {},
        });
        expect(result.valid).toBe(false);
      });
    }
  });
});

describe("validatePartialComponentInstance", () => {
  it("passes without required fields (draft mode)", () => {
    const result = validatePartialComponentInstance("text", "graphic", {
      fontSize: 14, // only optional field provided
    });
    expect(result.valid).toBe(true);
  });

  it("still rejects invalid field types in partial mode", () => {
    const result = validatePartialComponentInstance("text", "graphic", {
      color: "not-a-color",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "color")).toBe(true);
  });

  it("still rejects invalid enum in partial mode", () => {
    const result = validatePartialComponentInstance("text", "graphic", {
      alignment: "diagonal",
    });
    expect(result.valid).toBe(false);
  });
});

describe("applyDefaults", () => {
  it("fills in default values for missing fields", () => {
    const result = applyDefaults("text", {});
    expect(result.fontFamily).toBe("Inter");
    expect(result.fontSize).toBe(12);
    expect(result.color).toBe("#000000");
    expect(result.alignment).toBe("left");
  });

  it("does not overwrite existing values", () => {
    const result = applyDefaults("text", { fontSize: 24, color: "#FF0000" });
    expect(result.fontSize).toBe(24);
    expect(result.color).toBe("#FF0000");
  });

  it("returns unchanged object for unknown type", () => {
    const input = { foo: "bar" };
    const result = applyDefaults("unknown_type" as any, input);
    expect(result).toEqual(input);
  });

  it("applies defaults for sofa", () => {
    const result = applyDefaults("sofa", {});
    expect(result.height).toBe(850);
    expect(result.seatingCapacity).toBe(3);
    expect(result.material).toBe("fabric");
  });

  it("applies defaults for barcode", () => {
    const result = applyDefaults("barcode", {});
    expect(result.width).toBe(38);
    expect(result.height).toBe(25);
    expect(result.includeText).toBe(true);
  });
});
