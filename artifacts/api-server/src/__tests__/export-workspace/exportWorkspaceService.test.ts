/**
 * Tests for exportWorkspaceService — Team 17
 * Covers: validation, invalid dimensions, unsupported export,
 * estimate display, sanitisation, honest unavailable conversion,
 * and no raw internal metadata leak.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  validateExportRequest,
  estimateExport,
  sanitiseFilename,
} from "../../services/export-workspace/exportWorkspaceService.js";
import {
  exportFormatRegistry,
  initExportFormatRegistry,
  type ExportRequest,
} from "../../services/export-workspace/exportFormatRegistry.js";

// Initialise built-in formats once before all tests
beforeAll(() => {
  try {
    initExportFormatRegistry();
  } catch {
    // Already initialised (singleton) — safe to ignore
  }
});

// ── 5. Invalid dimensions ─────────────────────────────────────────────────────

describe("validateExportRequest — dimensions", () => {
  it("rejects negative width", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: {
        formatId: "png",
        dimensions: { width: -100, height: 200, unit: "px" },
      },
    };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.dimensions")).toBe(true);
  });

  it("rejects zero height", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: {
        formatId: "png",
        dimensions: { width: 200, height: 0, unit: "px" },
      },
    };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
  });

  it("rejects dimensions on a format that does not support them", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: {
        formatId: "pdf",
        dimensions: { width: 100, height: 200, unit: "px" },
      },
    };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.dimensions")).toBe(true);
  });

  it("accepts valid dimensions on PNG", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: {
        formatId: "png",
        dimensions: { width: 1920, height: 1080, unit: "px" },
      },
    };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(true);
  });
});

// ── 6. Unsupported export ─────────────────────────────────────────────────────

describe("validateExportRequest — unsupported formats", () => {
  it("rejects unknown formatId", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: { formatId: "totally_unknown" },
    };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.formatId")).toBe(true);
  });

  it("rejects unavailable format (SVG) with honest reason", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: { formatId: "svg" },
    };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    const svgError = result.errors.find((e) => e.field === "settings.formatId");
    expect(svgError?.message).toMatch(/not yet available|not available/i);
    // Must NOT say "PDF" or claim conversion exists
    expect(svgError?.message).not.toMatch(/converting|fake|success/i);
  });
});

// ── 7. Estimate display ───────────────────────────────────────────────────────

describe("estimateExport", () => {
  it("returns estimate for available format", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: { formatId: "pdf" },
    };
    const est = estimateExport(req, 5);
    expect(est.available).toBe(true);
    expect(est.pageCount).toBe(5);
    expect(est.estimatedDurationSeconds).toBeGreaterThan(0);
    expect(est.notes.length).toBeGreaterThan(0);
  });

  it("returns unavailable estimate for SVG (honest)", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: { formatId: "svg" },
    };
    const est = estimateExport(req, 1);
    expect(est.available).toBe(false);
    expect(est.unavailableReason).toBeTruthy();
    expect(est.estimatedCostCents).toBe(0);
    expect(est.estimatedDurationSeconds).toBe(0);
  });

  it("returns unavailable for unknown format (no crash)", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: { formatId: "does_not_exist" },
    };
    const est = estimateExport(req);
    expect(est.available).toBe(false);
    expect(est.unavailableReason).toBeTruthy();
  });

  it("uses page count from settings.pages when provided", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: { formatId: "pdf", pages: [1, 2, 3] },
    };
    const est = estimateExport(req, 10);
    // settings.pages overrides the pageCount arg
    expect(est.pageCount).toBe(3);
  });

  it("adds a high-resolution warning note", () => {
    const req: ExportRequest = {
      projectId: "proj-1",
      settings: { formatId: "png", resolution: 400 },
    };
    const est = estimateExport(req, 1);
    expect(est.notes.some((n) => /resolution/i.test(n))).toBe(true);
  });
});

// ── 8. Validation — missing fields ───────────────────────────────────────────

describe("validateExportRequest — required fields", () => {
  it("rejects missing projectId", () => {
    const req = { projectId: "", settings: { formatId: "pdf" } } as ExportRequest;
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "projectId")).toBe(true);
  });

  it("rejects missing settings", () => {
    const req = { projectId: "proj-1" } as ExportRequest;
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings")).toBe(true);
  });

  it("rejects missing formatId", () => {
    const req: ExportRequest = { projectId: "proj-1", settings: { formatId: "" } };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.formatId")).toBe(true);
  });

  it("accepts a valid minimal request", () => {
    const req: ExportRequest = { projectId: "proj-1", settings: { formatId: "pdf" } };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ── 9. Resolution validation ──────────────────────────────────────────────────

describe("validateExportRequest — resolution", () => {
  it("rejects resolution below 72", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "png", resolution: 30 } };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.resolution")).toBe(true);
  });

  it("rejects resolution above 600", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "png", resolution: 800 } };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
  });

  it("accepts valid resolution on PNG", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "png", resolution: 300 } };
    expect(validateExportRequest(req).valid).toBe(true);
  });

  it("rejects resolution on format that does not support it", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "pdf", resolution: 300 } };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.resolution")).toBe(true);
  });
});

// ── 10. Quality / compression ──────────────────────────────────────────────────

describe("validateExportRequest — quality and compression", () => {
  it("rejects quality=0 (out of range)", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "jpeg", quality: 0 } };
    expect(validateExportRequest(req).valid).toBe(false);
  });

  it("rejects quality=101", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "jpeg", quality: 101 } };
    expect(validateExportRequest(req).valid).toBe(false);
  });

  it("accepts quality=75 on jpeg", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "jpeg", quality: 75 } };
    expect(validateExportRequest(req).valid).toBe(true);
  });

  it("rejects compression on a format that does not support it", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "pdf", compression: 5 } };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.compression")).toBe(true);
  });
});

// ── 11. Page selection ────────────────────────────────────────────────────────

describe("validateExportRequest — page selection", () => {
  it("rejects non-integer page numbers", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "pdf", pages: [1, 1.5] } };
    expect(validateExportRequest(req).valid).toBe(false);
  });

  it("rejects zero-indexed pages (must be 1-based)", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "pdf", pages: [0, 1] } };
    expect(validateExportRequest(req).valid).toBe(false);
  });

  it("accepts valid page selection", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "pdf", pages: [1, 2, 5] } };
    expect(validateExportRequest(req).valid).toBe(true);
  });

  it("rejects pages on a format that does not support page selection", () => {
    const req: ExportRequest = { projectId: "p", settings: { formatId: "zip", pages: [1] } };
    const result = validateExportRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "settings.pages")).toBe(true);
  });
});

// ── 12. Filename sanitisation ─────────────────────────────────────────────────

describe("sanitiseFilename", () => {
  it("strips path separators", () => {
    expect(sanitiseFilename("../../etc/passwd", "pdf")).not.toContain("..");
    expect(sanitiseFilename("../../etc/passwd", "pdf")).not.toContain("/");
  });

  it("strips null bytes", () => {
    const name = "file\0name";
    expect(sanitiseFilename(name, "pdf")).not.toContain("\0");
  });

  it("mitigates CSV formula injection", () => {
    const formulaNames = ["=SUM(A1)", "+cmd|' /C calc'!A0", "-1+1", "@SUM(1+1)"];
    formulaNames.forEach((n) => {
      const safe = sanitiseFilename(n, "csv");
      expect(safe).not.toMatch(/^[=+\-@]/);
    });
  });

  it("appends the correct extension", () => {
    expect(sanitiseFilename("myfile", "pdf")).toMatch(/\.pdf$/);
    expect(sanitiseFilename("myfile.pdf", "pdf")).toMatch(/\.pdf$/);
  });

  it("falls back to 'export' for empty input", () => {
    expect(sanitiseFilename("", "png")).toBe("export.png");
  });

  it("caps length at 200 chars plus extension", () => {
    const long = "a".repeat(300);
    const result = sanitiseFilename(long, "pdf");
    expect(result.length).toBeLessThanOrEqual(205);
  });
});

// ── 18. Honest unavailable conversion ─────────────────────────────────────────

describe("honest unavailable conversion", () => {
  it("SVG format is marked unavailable with a non-empty reason", () => {
    const cap = exportFormatRegistry.getCapability("svg");
    expect(cap?.available).toBe(false);
    expect(cap?.unavailableReason).toBeTruthy();
    // Must explain the situation — not just say "unavailable"
    expect((cap?.unavailableReason ?? "").length).toBeGreaterThan(20);
  });

  it("SVG estimate shows unavailable with explanation", () => {
    const est = estimateExport({ projectId: "p", settings: { formatId: "svg" } });
    expect(est.available).toBe(false);
    expect(est.unavailableReason).toBeTruthy();
  });

  it("SVG validation returns an error mentioning availability", () => {
    const result = validateExportRequest({ projectId: "p", settings: { formatId: "svg" } });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ── 19. No raw internal metadata ──────────────────────────────────────────────

describe("no raw internal metadata in public contract", () => {
  it("ExportCapability does not expose engine-internal storage paths", () => {
    const cap = exportFormatRegistry.getCapability("pdf");
    // Capability shape must not include fields like storagePath, _tenantId, bucket
    expect(cap).not.toHaveProperty("storagePath");
    expect(cap).not.toHaveProperty("_tenantId");
    expect(cap).not.toHaveProperty("bucket");
  });

  it("ExportFormatDefinition does not expose secrets or credentials", () => {
    const fmt = exportFormatRegistry.getFormat("pdf");
    const keys = Object.keys(fmt ?? {});
    const dangerous = ["apiKey", "secret", "password", "token", "credential", "bucket"];
    for (const d of dangerous) {
      expect(keys).not.toContain(d);
    }
  });
});
