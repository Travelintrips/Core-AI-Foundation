import { describe, expect, it } from "vitest";
import {
  canonicalizeExportSections,
  isSameExportRequest,
} from "../exportIdempotency.js";

describe("Interior Design export idempotency signature", () => {
  it("canonicalizes section order and removes duplicate section names", () => {
    expect(canonicalizeExportSections(["moodboard", "materials", "materials"])).toEqual([
      "materials",
      "moodboard",
    ]);
  });

  it("reuses the canonical package for the same format and sections", () => {
    expect(isSameExportRequest(
      { format: "zip", includedSections: ["moodboard", "specification"] },
      { format: "zip", includedSections: ["specification", "moodboard"] },
    )).toBe(true);
  });

  it("rejects the same key when the format changes", () => {
    expect(isSameExportRequest(
      { format: "zip", includedSections: ["specification", "materials"] },
      { format: "materials_csv", includedSections: ["materials"] },
    )).toBe(false);
  });

  it("rejects the same key when the selected sections change", () => {
    expect(isSameExportRequest(
      { format: "zip", includedSections: ["specification", "materials"] },
      { format: "zip", includedSections: ["specification", "furniture"] },
    )).toBe(false);
  });
});