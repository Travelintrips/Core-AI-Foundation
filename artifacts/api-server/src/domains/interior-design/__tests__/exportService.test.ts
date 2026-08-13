import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  buildArtifacts,
  escapeCsvCell,
  type ExportSource,
} from "../exportService.js";

function makeSource(overrides: Partial<ExportSource["snapshot"]> = {}): ExportSource {
  return {
    projectUuid: "2f7c5b2c-0f2b-4e06-9db3-0ac5bd4d1b6e",
    tenantId: "tenant-a",
    sourceVersionId: "42",
    sourceVersionNumber: 3,
    sourceVersionHash: "source-hash",
    snapshot: {
      concept: "Warm, minimal living room",
      spacePlan: { zones: ["seating"] },
      materials: [{ id: "m-1", name: "Oak", notes: "=HYPERLINK(\"https://example.test\")" }],
      furniture: [{ id: "f-1", item: "Sofa", quantity: 1 }],
      lighting: [{ fixtureType: "Pendant", quantity: 2 }],
      moodboard: { references: ["neutral"] },
      assetRefs: [],
      ...overrides,
    },
  };
}

describe("WP-11 interior export compiler", () => {
  it("escapes spreadsheet formulas before writing CSV cells", () => {
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell("+cmd")).toBe("'+cmd");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(1+1)")).toBe("'@SUM(1+1)");
  });

  it("produces a PDF with a single-file manifest for a PDF format", async () => {
    const result = await buildArtifacts(makeSource(), "specification_pdf", ["specification"]);

    expect(result.mimeType).toBe("application/pdf");
    expect(result.fileName).toBe("specification.pdf");
    expect(result.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.manifest).toMatchObject({
      format: "specification_pdf",
      entries: [{ fileName: "specification.pdf", mimeType: "application/pdf" }],
    });
  });

  it("builds a deterministic ZIP with safe entries and a source manifest", async () => {
    const result = await buildArtifacts(makeSource(), "zip", [
      "specification",
      "materials",
      "furniture",
      "moodboard",
    ]);
    const archive = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(archive.files).sort();

    expect(result.mimeType).toBe("application/zip");
    expect(result.fileName).toBe("interior-design-package.zip");
    expect(names).toEqual([
      "furniture.csv",
      "furniture.pdf",
      "manifest.json",
      "materials.csv",
      "materials.pdf",
      "moodboard.pdf",
      "specification.pdf",
    ]);

    const manifest = JSON.parse(await archive.file("manifest.json")!.async("text")) as {
      schemaVersion: string;
      sourceVersionId: string;
      files: Array<{ fileName: string; checksum: string; fileSizeBytes: number }>;
    };
    expect(manifest).toMatchObject({
      schemaVersion: "interior-export-v1",
      sourceVersionId: "42",
    });
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.every((file) => file.checksum.length === 64 && file.fileSizeBytes > 0)).toBe(true);
  });

  it("keeps requested ZIP sections bounded to the selected files", async () => {
    const result = await buildArtifacts(makeSource(), "zip", ["materials"]);
    const archive = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(archive.files).sort();

    expect(names).toEqual(["manifest.json", "materials.csv", "materials.pdf"]);
  });
});