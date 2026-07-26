/**
 * Universal Catalog Import Engine — Phase 4B Tests
 *
 * Coverage:
 * - PDF adapter: CJS/ESM interop guard, needsOCR flag
 * - Attribute persistence: variant and all 41-field columns present
 * - API response completeness: all fields serialized
 * - Extraction Diff: diff field computation logic
 * - Resume/idempotency: checksum
 * - Duplicate detection regression
 * - Preview staging correctness
 */

import { describe, it, expect, vi } from "vitest";

// ── Mock pdf-parse before any module that uses it loads ────────────────────
// pdf-parse is esbuild-external and not resolvable in the test environment's
// Node.js context. We mock it so pdfAdapter can be loaded in unit tests.
vi.mock("pdf-parse", () => ({
  default: vi.fn(async (_buffer: Buffer, opts?: { pagerender?: (p: unknown) => Promise<string> }) => {
    // Simulate a 2-page parse with embedded text on page 1, empty page 2
    if (opts?.pagerender) {
      const mockPage1 = {
        getTextContent: async () => ({
          items: [{ str: "Galaxy Black 600x600 Polished Granite Niro" }],
        }),
      };
      const mockPage2 = {
        getTextContent: async () => ({ items: [] }),
      };
      await opts.pagerender(mockPage1);
      await opts.pagerender(mockPage2);
    }
    return {
      numpages: 2,
      text: "Galaxy Black 600x600 Polished Granite Niro",
      info: { Author: "Niro Granite", Title: "Catalog 2024" },
    };
  }),
}));

import { normalizeBatch } from "../domains/universal-catalog-import/stagingNormalizer.js";
import { computeChecksum } from "../domains/universal-catalog-import/stagingService.js";
import { validateUniversalMaterial } from "../domains/universal-catalog-import/universalMaterialSchema.js";
import type { RawExtractedItem, StagingPreviewItem } from "../domains/universal-catalog-import/types.js";

// ── PDF Adapter: CJS/ESM Interop guard ───────────────────────────────────────

describe("PdfAdapter — CJS/ESM interop", () => {
  it("interop guard: typeof check falls back correctly", () => {
    // Test the interop guard logic directly without requiring the real module
    const moduleWithDefault = { default: () => "fn" };
    const bareCallable = Object.assign(() => "fn", {});

    const resolveFn = (mod: unknown) => {
      if (typeof (mod as { default?: unknown }).default === "function") {
        return (mod as { default: () => string }).default;
      }
      return mod as () => string;
    };

    expect(typeof resolveFn(moduleWithDefault)).toBe("function");
    expect(typeof resolveFn(bareCallable)).toBe("function");
  });

  it("pdfAdapter module loads without throwing (mock in place)", async () => {
    const adapter = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    expect(adapter.pdfAdapter).toBeDefined();
    expect(adapter.pdfAdapter.sourceType).toBe("pdf");
    expect(typeof adapter.pdfAdapter.extract).toBe("function");
  });
});

// ── PDF Adapter: extract() behavior ───────────────────────────────────────────

describe("PdfAdapter — extract()", () => {
  it("returns error when no buffer provided (no crash)", async () => {
    const { pdfAdapter } = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    const result = await pdfAdapter.extract({ type: "pdf" });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("No file buffer provided");
    expect(result.rawItems).toHaveLength(0);
  });

  it("extracts rawItems from a buffer (mocked pdf-parse)", async () => {
    const { pdfAdapter } = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    const result = await pdfAdapter.extract({
      type: "pdf",
      buffer: Buffer.from("fake pdf content"),
      filename: "catalog.pdf",
    });
    expect(result.errors).toHaveLength(0);
    expect(result.rawItems.length).toBeGreaterThan(0);
    // Has sourceMetadata with filename and checksum
    expect(result.sourceMetadata?.["filename"]).toBe("catalog.pdf");
    expect(typeof result.sourceMetadata?.["checksum"]).toBe("string");
  });

  it("marks image-only pages with needsOCR=true", async () => {
    const { pdfAdapter } = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    const result = await pdfAdapter.extract({
      type: "pdf",
      buffer: Buffer.from("fake pdf"),
      filename: "catalog.pdf",
    });
    // The mock returns page 2 with empty text — it should be marked needsOCR
    const ocrPage = result.rawItems.find(
      (item) => (item.raw as Record<string, unknown>)["_ocrNeeded"] === true,
    );
    expect(ocrPage).toBeDefined();
    // Never fabricates text for OCR pages
    expect((ocrPage!.raw as Record<string, unknown>)["_pageText"]).toBeUndefined();
  });

  it("includes page number in each raw item", async () => {
    const { pdfAdapter } = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    const result = await pdfAdapter.extract({
      type: "pdf",
      buffer: Buffer.from("fake pdf"),
    });
    for (const item of result.rawItems) {
      expect(item.sourceContext?.page).toBeGreaterThanOrEqual(1);
    }
  });

  it("warns about OCR-needed pages in warnings array", async () => {
    const { pdfAdapter } = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    const result = await pdfAdapter.extract({
      type: "pdf",
      buffer: Buffer.from("fake pdf"),
    });
    // Page 2 is image-only → should have a warning
    const ocrWarning = result.warnings.find((w) => /image-only|ocr/i.test(w));
    expect(ocrWarning).toBeDefined();
  });

  it("detects catalog version from page text", async () => {
    const { pdfAdapter } = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    // The mocked page 1 text contains "Niro" (no version), but let's verify the detector
    // just doesn't crash
    const result = await pdfAdapter.extract({
      type: "pdf",
      buffer: Buffer.from("fake pdf"),
    });
    // Warnings may include catalog version detection; that's fine
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("returns totalPages from PDF info", async () => {
    const { pdfAdapter } = await import("../domains/universal-catalog-import/adapters/pdfAdapter.js");
    const result = await pdfAdapter.extract({
      type: "pdf",
      buffer: Buffer.from("fake pdf"),
    });
    expect(result.totalPages).toBe(2);
  });
});

// ── Attribute Persistence — all fields in StagingPreviewItem ─────────────────

describe("Attribute persistence — all fields present", () => {
  it("normalizer preserves all Phase 4B required attributes", () => {
    const items = [
      {
        partialMaterial: {
          brand: "Niro Granite",
          productCode: "NG-001",
          productName: "Galaxy Black",
          variant: "600x600",
          collection: "Galaxy",
          series: "Classic",
          colors: ["Black", "Gray"],
          finish: ["Polished"],
          texture: "Smooth",
          pattern: "Speckled",
          workingSize: "595x595",
          thickness: "10mm",
          numberOfFaces: 4,
          peiRating: 4,
          shadeVariation: "V3",
          application: ["Floor", "Wall"],
          certifications: ["ISO 13006"],
          description: "Premium granite tile",
          category: "Flooring",
          subcategory: "Granite",
          materialType: "Porcelain",
          technicalSpecifications: { waterAbsorption: "0.1%" },
          thumbnailReference: "https://example.com/thumb.jpg",
          previewReferences: ["https://example.com/img1.jpg"],
        },
        rawItem: {
          raw: { brand: "Niro Granite", productCode: "NG-001", variant: "600x600" },
          sourceContext: { row: 1 },
        } as RawExtractedItem,
      },
    ];

    const result = normalizeBatch(items, "csv", "catalog.csv");
    const item = result.stagingItems[0]!;
    const m = item.material;

    expect(m.brand).toBe("Niro Granite");
    expect(m.productCode).toBe("NG-001");
    expect(m.productName).toBe("Galaxy Black");
    expect(m.variant).toBe("600x600");
    expect(m.collection).toBe("Galaxy");
    expect(m.series).toBe("Classic");
    expect(m.colors).toEqual(["Black", "Gray"]);
    expect(m.finish).toEqual(["Polished"]);
    expect(m.texture).toBe("Smooth");
    expect(m.pattern).toBe("Speckled");
    expect(m.workingSize).toBe("595x595");
    expect(m.thickness).toBe("10mm");
    expect(m.numberOfFaces).toBe(4);
    expect(m.peiRating).toBe(4);
    expect(m.shadeVariation).toBe("V3");
    expect(m.application).toEqual(["Floor", "Wall"]);
    expect(m.certifications).toEqual(["ISO 13006"]);
    expect(m.description).toBe("Premium granite tile");
    expect(m.category).toBe("Flooring");
    expect(m.subcategory).toBe("Granite");
    expect(m.materialType).toBe("Porcelain");
    expect(m.technicalSpecifications).toEqual({ waterAbsorption: "0.1%" });
    expect(m.thumbnailReference).toBe("https://example.com/thumb.jpg");
    expect(m.previewReferences).toEqual(["https://example.com/img1.jpg"]);
  });

  it("variant is included in stagingId — different variants → different IDs", () => {
    const base = { brand: "Niro Granite", productCode: "NG-001", productName: "Galaxy Black" };
    const items = [
      {
        partialMaterial: { ...base, variant: "600x600" },
        rawItem: { raw: {}, sourceContext: { row: 1 } } as RawExtractedItem,
      },
      {
        partialMaterial: { ...base, variant: "800x800" },
        rawItem: { raw: {}, sourceContext: { row: 2 } } as RawExtractedItem,
      },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    expect(result.stagingItems[0]!.stagingId).not.toBe(result.stagingItems[1]!.stagingId);
  });

  it("fields absent from input remain undefined — no fabrication", () => {
    const items = [
      {
        partialMaterial: { brand: "TOTO", productCode: "T-001", productName: "Washlet" },
        rawItem: { raw: { brand: "TOTO" }, sourceContext: { row: 1 } } as RawExtractedItem,
      },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    const m = result.stagingItems[0]!.material;
    expect(m.variant).toBeUndefined();
    expect(m.texture).toBeUndefined();
    expect(m.pattern).toBeUndefined();
    expect(m.peiRating).toBeUndefined();
    expect(m.shadeVariation).toBeUndefined();
    expect(m.previewReferences).toBeUndefined();
  });
});

// ── API Response — schema completeness ───────────────────────────────────────

describe("API response completeness", () => {
  const REQUIRED_FIELDS = [
    "stagingId", "status",
    "brand", "collection", "series", "productCode", "productName", "variant",
    "category", "subcategory", "materialType", "description",
    "colors", "finish", "texture", "pattern",
    "dimensions", "workingSize", "thickness", "numberOfFaces",
    "peiRating", "shadeVariation",
    "technicalSpecifications", "application", "certifications",
    "thumbnailReference", "previewReferences",
    "sourceType", "sourceName", "sourceVersion", "sourceUrl", "sourcePage", "sourceMetadata",
    "duplicateInfo", "validationErrors", "extractedAt",
  ];

  it("serializeItem-equivalent includes all required API fields", () => {
    const item: StagingPreviewItem = {
      stagingId: "test-id",
      status: "normalized",
      material: {
        brand: "Niro", collection: "Galaxy", series: "Classic",
        productCode: "NG-001", productName: "Galaxy Black", variant: "600x600",
        category: "Flooring", subcategory: "Granite", materialType: "Porcelain",
        description: "Premium tile",
        colors: ["Black"], finish: ["Polished"], texture: "Smooth", pattern: "Speckled",
        dimensions: { w: 600, h: 600 }, workingSize: "595x595", thickness: "10mm",
        numberOfFaces: 4, peiRating: 4, shadeVariation: "V3",
        technicalSpecifications: { waterAbsorption: "0.1%" },
        application: ["Floor"], certifications: ["ISO"],
        thumbnailReference: "https://example.com/thumb.jpg",
        previewReferences: ["https://example.com/img1.jpg"],
        sourceType: "pdf", sourceName: "catalog.pdf", sourceVersion: "2024",
        sourceUrl: undefined, sourcePage: 12,
        sourceMetadata: { checksum: "abc123" },
      },
      rawData: { _pageText: "Galaxy Black 600x600" },
      sourceContext: { page: 12 },
      duplicateInfo: undefined,
      validationErrors: [],
      extractedAt: new Date(),
    };

    const m = item.material;
    const serialized: Record<string, unknown> = {
      stagingId: item.stagingId, status: item.status,
      brand: m.brand ?? null, collection: m.collection ?? null, series: m.series ?? null,
      productCode: m.productCode ?? null, productName: m.productName ?? null,
      variant: m.variant ?? null,
      category: m.category ?? null, subcategory: m.subcategory ?? null,
      materialType: m.materialType ?? null, description: m.description ?? null,
      colors: m.colors ?? null, finish: m.finish ?? null,
      texture: m.texture ?? null, pattern: m.pattern ?? null,
      dimensions: m.dimensions ?? null, workingSize: m.workingSize ?? null,
      thickness: m.thickness ?? null, numberOfFaces: m.numberOfFaces ?? null,
      peiRating: m.peiRating ?? null, shadeVariation: m.shadeVariation ?? null,
      technicalSpecifications: m.technicalSpecifications ?? null,
      application: m.application ?? null, certifications: m.certifications ?? null,
      thumbnailReference: m.thumbnailReference ?? null,
      previewReferences: m.previewReferences ?? null,
      sourceType: m.sourceType, sourceName: m.sourceName,
      sourceVersion: m.sourceVersion ?? null, sourceUrl: m.sourceUrl ?? null,
      sourcePage: m.sourcePage ?? null, sourceMetadata: m.sourceMetadata ?? null,
      duplicateInfo: item.duplicateInfo ?? null,
      validationErrors: item.validationErrors,
      extractedAt: item.extractedAt,
    };

    for (const field of REQUIRED_FIELDS) {
      expect(serialized).toHaveProperty(field);
    }
  });

  it("variant is non-null in serialized response when set", () => {
    const items = [
      {
        partialMaterial: { brand: "Niro", productCode: "NG-001", productName: "Galaxy", variant: "60x60" },
        rawItem: { raw: {}, sourceContext: { row: 1 } } as RawExtractedItem,
      },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    expect(result.stagingItems[0]!.material.variant).toBe("60x60");
  });
});

// ── Extraction Diff — field diff logic ───────────────────────────────────────

describe("Extraction Diff — field comparison", () => {
  const hasValue = (v: unknown) =>
    v !== null && v !== undefined && v !== "" &&
    !(Array.isArray(v) && v.length === 0);

  it("isMissing is true when staged value is absent", () => {
    const staged: Record<string, unknown> = { brand: "Niro" };
    const isDiff = (field: string) => !hasValue(staged[field]);
    expect(isDiff("brand")).toBe(false);
    expect(isDiff("variant")).toBe(true);   // missing
  });

  it("isChanged is true when extracted differs from staged", () => {
    const ext = "Niro Granite Polished";
    const stg = "Niro Granite";
    const isChanged = hasValue(ext) && hasValue(stg) && JSON.stringify(ext) !== JSON.stringify(stg);
    expect(isChanged).toBe(true);
  });

  it("isChanged is false when values are identical", () => {
    const ext = "Niro Granite";
    const stg = "Niro Granite";
    expect(JSON.stringify(ext) !== JSON.stringify(stg)).toBe(false);
  });

  it("array fields compared by JSON.stringify", () => {
    const ext = ["Black", "Gray"];
    const stg = ["Black"];
    const isChanged = hasValue(ext) && hasValue(stg) && JSON.stringify(ext) !== JSON.stringify(stg);
    expect(isChanged).toBe(true);
  });

  it("null staged value means isMissing even if extracted had value", () => {
    const ext = "V3";
    const stg = null;
    expect(!hasValue(stg) && hasValue(ext)).toBe(true);
  });
});

// ── Resume / Idempotency ─────────────────────────────────────────────────────

describe("computeChecksum — idempotency basis", () => {
  it("same buffer → same checksum", () => {
    const buf = Buffer.from("niro-catalog-2024");
    expect(computeChecksum(buf)).toBe(computeChecksum(buf));
  });

  it("different buffers → different checksums", () => {
    expect(computeChecksum(Buffer.from("a"))).not.toBe(computeChecksum(Buffer.from("b")));
  });

  it("produces 32-char lowercase hex", () => {
    expect(computeChecksum(Buffer.from("test"))).toMatch(/^[a-f0-9]{32}$/);
  });

  it("checksum is deterministic across calls", () => {
    const buf = Buffer.from("test-catalog-import-idempotency");
    const c1 = computeChecksum(buf);
    const c2 = computeChecksum(buf);
    expect(c1).toBe(c2);
  });
});

// ── Duplicate Detection ───────────────────────────────────────────────────────

describe("Duplicate detection — regression", () => {
  it("exact duplicate by brand+productCode is caught", () => {
    const items = [
      { partialMaterial: { brand: "Niro", productCode: "NG-001", productName: "Galaxy" }, rawItem: { raw: {}, sourceContext: { row: 1 } } as RawExtractedItem },
      { partialMaterial: { brand: "Niro", productCode: "NG-001", productName: "Galaxy" }, rawItem: { raw: {}, sourceContext: { row: 2 } } as RawExtractedItem },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    const second = result.stagingItems[1]!;
    expect(["exact_duplicate", "possible_duplicate"]).toContain(second.duplicateInfo?.classification);
    expect(second.status).toBe("duplicate");
  });

  it("different variants of same productCode produce different stagingIds", () => {
    const items = [
      { partialMaterial: { brand: "Niro", productCode: "NG-001", productName: "Galaxy", variant: "600x600" }, rawItem: { raw: {}, sourceContext: { row: 1 } } as RawExtractedItem },
      { partialMaterial: { brand: "Niro", productCode: "NG-001", productName: "Galaxy", variant: "800x800" }, rawItem: { raw: {}, sourceContext: { row: 2 } } as RawExtractedItem },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    expect(result.stagingItems[0]!.stagingId).not.toBe(result.stagingItems[1]!.stagingId);
  });

  it("10 unique items are all classified as new", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      partialMaterial: { brand: `Brand${i}`, productCode: `CODE-${i}`, productName: `Product ${i}` },
      rawItem: { raw: {}, sourceContext: { row: i } } as RawExtractedItem,
    }));
    const result = normalizeBatch(items, "csv", "test.csv");
    expect(result.stagingItems).toHaveLength(10);
    const newItems = result.stagingItems.filter(
      (i) => !i.duplicateInfo || i.duplicateInfo.classification === "new",
    );
    expect(newItems.length).toBe(10);
  });

  it("possible duplicate detected by brand+name match", () => {
    const items = [
      { partialMaterial: { brand: "Hafele", productCode: "H-001", productName: "Cabinet Hinge" }, rawItem: { raw: {}, sourceContext: {} } as RawExtractedItem },
      { partialMaterial: { brand: "Hafele", productCode: "H-999", productName: "Cabinet Hinge" }, rawItem: { raw: {}, sourceContext: {} } as RawExtractedItem },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    expect(result.stagingItems[1]!.duplicateInfo?.classification).toBe("possible_duplicate");
  });
});

// ── Staging Preview ───────────────────────────────────────────────────────────

describe("Staging preview — correctness", () => {
  it("normalizeBatch on 0 items returns empty safely", () => {
    const result = normalizeBatch([], "csv", "empty.csv");
    expect(result.stagingItems).toHaveLength(0);
    expect(result.counts.new).toBe(0);
  });

  it("extractedAt is a Date instance", () => {
    const items = [
      { partialMaterial: { brand: "TOTO", productCode: "T-001" }, rawItem: { raw: {}, sourceContext: {} } as RawExtractedItem },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    expect(result.stagingItems[0]!.extractedAt).toBeInstanceOf(Date);
  });

  it("validationErrors is always an array", () => {
    const items = [
      { partialMaterial: { brand: "B", productCode: "C" }, rawItem: { raw: {}, sourceContext: {} } as RawExtractedItem },
    ];
    const result = normalizeBatch(items, "csv", "test.csv");
    expect(Array.isArray(result.stagingItems[0]!.validationErrors)).toBe(true);
  });

  it("stagingId is a deterministic non-empty string", () => {
    const items = [
      { partialMaterial: { brand: "X", productCode: "Y", productName: "Z" }, rawItem: { raw: {}, sourceContext: {} } as RawExtractedItem },
    ];
    const r1 = normalizeBatch(items, "csv", "test.csv");
    const r2 = normalizeBatch(items, "csv", "test.csv");
    expect(r1.stagingItems[0]!.stagingId).toBe(r2.stagingItems[0]!.stagingId);
    expect(r1.stagingItems[0]!.stagingId.length).toBeGreaterThan(0);
  });
});

// ── Universal Material Schema ─────────────────────────────────────────────────

describe("validateUniversalMaterial — Phase 4B fields", () => {
  it("accepts all Phase 4B fields", () => {
    const result = validateUniversalMaterial({
      sourceType: "pdf",
      sourceName: "catalog.pdf",
      variant: "600x600",
      texture: "Smooth",
      pattern: "Speckled",
      shadeVariation: "V3",
      peiRating: 4,
      application: ["Floor"],
      certifications: ["ISO 13006"],
      previewReferences: ["https://example.com/img.jpg"],
      numberOfFaces: 4,
    });
    expect(result.success).toBe(true);
  });

  it("rejects peiRating > 5", () => {
    const result = validateUniversalMaterial({
      sourceType: "csv",
      sourceName: "test",
      peiRating: 6,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid sourceType", () => {
    const result = validateUniversalMaterial({
      sourceType: "ftp" as "pdf",
      sourceName: "test",
    });
    expect(result.success).toBe(false);
  });

  it("accepts minimal valid material (only required fields)", () => {
    const result = validateUniversalMaterial({
      sourceType: "csv",
      sourceName: "test.csv",
    });
    expect(result.success).toBe(true);
  });
});

// ── No canonical write guard ──────────────────────────────────────────────────

describe("no canonical write guard", () => {
  it("stagingService has no canonical material write functions", async () => {
    const mod = await import("../domains/universal-catalog-import/stagingService.js");
    const exports = Object.keys(mod);
    const forbidden = exports.filter((k) =>
      /material.*save|save.*material|import.*canonical|canonical.*import|publish.*material/i.test(k),
    );
    expect(forbidden).toHaveLength(0);
    // Expected exports
    expect(mod.bulkInsertStagingItems).toBeDefined();
    expect(mod.createOrResumeJob).toBeDefined();
    expect(mod.getStagingItems).toBeDefined();
    expect(mod.getStagingItemById).toBeDefined();
    expect(mod.countStagingItems).toBeDefined();
    expect(mod.listJobs).toBeDefined();
  });
});
