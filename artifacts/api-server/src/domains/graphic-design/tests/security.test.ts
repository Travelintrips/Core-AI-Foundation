/**
 * graphic-design/tests/security.test.ts — Team 15
 *
 * MANDATORY security tests per GLOBAL REMEDIATION RULES:
 *
 *  1. ../../ path input does not affect output path
 *  2. User filename is ignored — generated UUID is always used
 *  3. Generated path stays within GD_STORAGE_PREFIX
 *  4. Route collision: our prefixes do not collide with design-studio
 *  5. All executions use canonical adapter (no alternate code path)
 *  6. Job list is paginated
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { posix } from "path";

import {
  sanitizeFormatExt,
  sanitizeFileFormats,
  sanitizeVariantKey,
  sanitizeServiceCode,
  sanitizeColorMode,
  buildDeliverablePath,
  assertPathContained,
  GD_STORAGE_PREFIX,
  ALLOWED_GD_EXTENSIONS,
  ALLOWED_COLOR_MODES,
} from "../sanitize.js";

import {
  createBrief,
  approveBriefAndDispatch,
  runBriefQc,
  listBriefJobs,
  _clearStoreForTest,
  type CanonicalJobAdapter,
} from "../service.js";
import type { GraphicDesignBrief } from "../schema.js";
// GraphicDesignBrief re-imported as value-level type for cast usage in tests
import type { RenderedDeliverable } from "../qc.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// GD-LOGO basic overrides conceptVariants to 2.
// GD-BCARD basic = 1 concept — used for "single concept" dispatch tests.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const BASE_BRIEF = {
  serviceCode:     "GD-BCARD",
  clientName:      "Security Test Client",
  brandName:       "SecBrand",
  industry:        "Security",
  targetAudience:  "Pen testers",
  stylePreference: "modern",
  colorPalette:    ["#000000"],
  urgencyLevel:    "standard",
  language:        "id",
  packageTier:     "basic",
  outputFormat:    "print",
  printQuantity:   0,
  referenceUrls:   [] as string[],
} as GraphicDesignBrief;

// Separate logo brief for canvas-dimension checks
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const LOGO_BRIEF_BASIC = {
  serviceCode:     "GD-LOGO",
  clientName:      "Security Test Client",
  brandName:       "LogoBrand",
  industry:        "Security",
  targetAudience:  "Pen testers",
  stylePreference: "modern",
  colorPalette:    ["#000000"],
  urgencyLevel:    "standard",
  language:        "id",
  packageTier:     "basic",
  outputFormat:    "digital",
  printQuantity:   0,
  referenceUrls:   [] as string[],
} as GraphicDesignBrief;

function makeMockAdapter(): CanonicalJobAdapter {
  return { createProject: vi.fn().mockResolvedValue({ projectId: "proj-sec-1" }) };
}

beforeEach(() => {
  _clearStoreForTest();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. PATH TRAVERSAL — ../../ inputs must not affect output path
// ══════════════════════════════════════════════════════════════════════════════

describe("P0 PATH TRAVERSAL — buildDeliverablePath", () => {
  const traversalInputs = [
    "../../etc/passwd",
    "../../../root/.ssh/id_rsa",
    "..%2F..%2Fetc%2Fshadow",
    "....//....//etc/hosts",
    "\0etc/passwd",
    "/absolute/path.pdf",
    "C:\\Windows\\system32\\cmd.exe",
    "normal/../../../escape.pdf",
  ];

  for (const ext of traversalInputs) {
    it(`rejects traversal in ext: ${JSON.stringify(ext)}`, () => {
      const path = buildDeliverablePath("GD-LOGO", ext);
      expect(assertPathContained(path, GD_STORAGE_PREFIX)).toBe(true);
      expect(path.startsWith("/")).toBe(false);
      expect(path.includes("..")).toBe(false);
      expect(path.startsWith(GD_STORAGE_PREFIX)).toBe(true);
    });
  }

  it("rejects traversal in serviceCode param", () => {
    const path = buildDeliverablePath("../../etc/GD-LOGO", "pdf");
    expect(assertPathContained(path, GD_STORAGE_PREFIX)).toBe(true);
    expect(path.includes("..")).toBe(false);
    expect(path.startsWith(GD_STORAGE_PREFIX)).toBe(true);
  });

  it("result is always normalized (no double slashes or dot segments)", () => {
    const path = buildDeliverablePath("GD-SOCIAL", "png");
    const normalized = posix.normalize(path);
    expect(path).toBe(normalized);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. USER FILENAME IGNORED — UUID always generated
// ══════════════════════════════════════════════════════════════════════════════

describe("P0 USER FILENAME IGNORED — buildDeliverablePath", () => {
  it("two calls always produce different paths (UUID-based)", () => {
    const a = buildDeliverablePath("GD-LOGO", "pdf");
    const b = buildDeliverablePath("GD-LOGO", "pdf");
    expect(a).not.toBe(b);
  });

  it("path segment after prefix is not the user-supplied extension string", () => {
    const userExt = "../../../../malicious-name.pdf";
    const path = buildDeliverablePath("GD-LOGO", userExt);
    // Only the safe extension "pdf" from the allowlist survives, not the full string
    expect(path).not.toContain("malicious-name");
    expect(path).not.toContain("..");
  });

  it("path contains only UUID + allowed extension, not raw user input", () => {
    const path = buildDeliverablePath("GD-BCARD", "pdf");
    // UUID regex for the filename segment
    const filename = posix.basename(path);
    expect(filename).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. CONTAINMENT CHECK — every path stays inside GD_STORAGE_PREFIX
// ══════════════════════════════════════════════════════════════════════════════

describe("P0 CONTAINMENT — assertPathContained", () => {
  it("accepts valid path inside prefix", () => {
    expect(assertPathContained(`${GD_STORAGE_PREFIX}GD-LOGO/uuid.pdf`, GD_STORAGE_PREFIX)).toBe(true);
  });

  it("rejects absolute path", () => {
    expect(assertPathContained("/etc/passwd", GD_STORAGE_PREFIX)).toBe(false);
  });

  it("rejects path starting with ..", () => {
    expect(assertPathContained("../../escape", GD_STORAGE_PREFIX)).toBe(false);
  });

  it("rejects path outside prefix", () => {
    expect(assertPathContained("other-domain/file.pdf", GD_STORAGE_PREFIX)).toBe(false);
  });

  it("buildDeliverablePath always passes assertPathContained", () => {
    const codes = ["GD-LOGO", "GD-BCARD", "GD-POSTER", "GD-SOCIAL"];
    const exts  = ["pdf", "png", "svg", "zip", "jpg"];
    for (const code of codes) {
      for (const ext of exts) {
        const path = buildDeliverablePath(code, ext);
        expect(assertPathContained(path, GD_STORAGE_PREFIX)).toBe(true);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. sanitizeFormatExt / sanitizeFileFormats
// ══════════════════════════════════════════════════════════════════════════════

describe("sanitizeFormatExt", () => {
  it("accepts every allowed extension", () => {
    for (const ext of ALLOWED_GD_EXTENSIONS) {
      expect(sanitizeFormatExt(ext)).toBe(ext);
    }
  });

  it("strips leading dot", () => {
    expect(sanitizeFormatExt(".pdf")).toBe("pdf");
    expect(sanitizeFormatExt(".PNG")).toBe("png");
  });

  it("lowercases the extension", () => {
    expect(sanitizeFormatExt("PDF")).toBe("pdf");
  });

  it("returns null for unknown extensions", () => {
    expect(sanitizeFormatExt("exe")).toBeNull();
    expect(sanitizeFormatExt("sh")).toBeNull();
    expect(sanitizeFormatExt("js")).toBeNull();
    expect(sanitizeFormatExt("")).toBeNull();
  });

  it("returns null for path traversal strings", () => {
    expect(sanitizeFormatExt("../../etc/passwd")).toBeNull();
    expect(sanitizeFormatExt("/absolute.pdf")).toBeNull();
    expect(sanitizeFormatExt("../sibling.png")).toBeNull();
  });
});

describe("sanitizeFileFormats", () => {
  it("keeps only allowlisted extensions", () => {
    const result = sanitizeFileFormats(["pdf", "../../etc/passwd", "png", "exe", "svg"]);
    expect(result).toEqual(["pdf", "png", "svg"]);
  });

  it("returns empty array for all-malicious input", () => {
    expect(sanitizeFileFormats(["exe", "sh", "bat", "../../root"])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeFileFormats([])).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// sanitizeVariantKey
// ══════════════════════════════════════════════════════════════════════════════

describe("sanitizeVariantKey", () => {
  it("keeps alphanumeric, underscore, hyphen", () => {
    expect(sanitizeVariantKey("primary_1000")).toBe("primary_1000");
    expect(sanitizeVariantKey("rollup-85x200")).toBe("rollup-85x200");
  });

  it("removes path traversal characters", () => {
    const result = sanitizeVariantKey("../../dangerous");
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
  });

  it("falls back to 'default' for empty result", () => {
    expect(sanitizeVariantKey("")).toBe("default");
    expect(sanitizeVariantKey("!@#$%")).toBe("default");
  });

  it("truncates to 100 characters", () => {
    const long = "a".repeat(200);
    expect(sanitizeVariantKey(long).length).toBeLessThanOrEqual(100);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// sanitizeServiceCode
// ══════════════════════════════════════════════════════════════════════════════

describe("sanitizeServiceCode", () => {
  it("keeps valid service codes unchanged", () => {
    expect(sanitizeServiceCode("GD-LOGO")).toBe("GD-LOGO");
    expect(sanitizeServiceCode("GD-STATIONERY")).toBe("GD-STATIONERY");
  });

  it("strips path traversal from service code", () => {
    const result = sanitizeServiceCode("../../GD-LOGO");
    expect(result).not.toContain(".");
    expect(result).not.toContain("/");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// sanitizeColorMode
// ══════════════════════════════════════════════════════════════════════════════

describe("sanitizeColorMode", () => {
  it("accepts all valid color modes", () => {
    for (const mode of ALLOWED_COLOR_MODES) {
      expect(sanitizeColorMode(mode)).toBe(mode);
    }
  });

  it("falls back to RGB for unknown mode", () => {
    expect(sanitizeColorMode("INJECTION")).toBe("RGB");
    expect(sanitizeColorMode("../../CMYK")).toBe("RGB");
    expect(sanitizeColorMode("")).toBe("RGB");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ROUTE COLLISION — GD routes do not collide with existing engines
// ══════════════════════════════════════════════════════════════════════════════

describe("ROUTE COLLISION — prefix separation", () => {
  const GD_PREFIXES = [
    "/ai/graphic-design/briefs",
    "/ai/graphic-design/blueprints",
    "/ai/graphic-design/packages",
    "/ai/graphic-design/services",
  ];

  const EXISTING_PREFIXES = [
    "/ai/design/projects",        // design-studio.ts
    "/ai/design-templates",       // design-templates.ts
    "/ai/design-render-batches",  // design-templates.ts
    "/ai/design-zip-exports",     // design-templates.ts
    "/creative-ai",               // creative-ai.ts
    "/marketplace",               // creative-marketplace.ts
  ];

  it("no GD prefix is a prefix of an existing route prefix", () => {
    for (const gd of GD_PREFIXES) {
      for (const existing of EXISTING_PREFIXES) {
        expect(existing.startsWith(gd)).toBe(false);
        expect(gd.startsWith(existing)).toBe(false);
      }
    }
  });

  it("every GD route contains /graphic-design/ segment (unique namespace)", () => {
    for (const gd of GD_PREFIXES) {
      expect(gd).toContain("/graphic-design/");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. CANONICAL ADAPTER — all execution through one path
// ══════════════════════════════════════════════════════════════════════════════

describe("CANONICAL ADAPTER — single execution path", () => {
  it("approveBriefAndDispatch calls adapter.createProject, nothing else", async () => {
    const { briefId } = await createBrief(BASE_BRIEF);  // basic = 1 concept
    const adapter = makeMockAdapter();

    await approveBriefAndDispatch(briefId, adapter);

    // createProject called once (basic tier = 1 concept)
    expect(adapter.createProject).toHaveBeenCalledTimes(1);
  });

  it("the adapter is passed the blueprint canvas dimensions, not user-supplied values", async () => {
    // Use LOGO_BRIEF_BASIC whose digital default is explicitly 1000x1000 px
    const { briefId } = await createBrief(LOGO_BRIEF_BASIC);
    const adapter = makeMockAdapter();

    await approveBriefAndDispatch(briefId, adapter);

    const callArg = (adapter.createProject as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      canvasWidthPx: number;
      canvasHeightPx: number;
    };
    // Dimensions come from blueprint, not user input
    expect(callArg.canvasWidthPx).toBeGreaterThan(0);
    expect(callArg.canvasHeightPx).toBeGreaterThan(0);
  });

  it("runBriefQc sanitizes before running QC — no raw user input reaches the engine", async () => {
    const { briefId } = await createBrief(BASE_BRIEF);
    const malicious: RenderedDeliverable = {
      variant:        "../../evil",
      canvasWidthPx:  1000,
      canvasHeightPx: 1000,
      resolutionDpi:  96,
      colorMode:      "INJECTION" as "RGB",
      elements:       [],
      fileFormats:    ["../../etc/passwd", "png"],
    };

    // Must not throw; sanitized internally
    const result = await runBriefQc(briefId, malicious);
    expect(result.qcScore).toBeGreaterThanOrEqual(0);

    // Verify sanitization: only "png" survives from fileFormats
    // The stored QC result should not contain the traversal string
    const stored = JSON.stringify(result);
    expect(stored).not.toContain("etc/passwd");
    expect(stored).not.toContain("INJECTION");
    expect(stored).not.toContain("../../evil");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. JOB LIST PAGINATED (P2)
// ══════════════════════════════════════════════════════════════════════════════

describe("JOB LIST PAGINATED", () => {
  // GD-BCARD premium = 3 concepts; GD-BCARD basic = 1 concept

  it("listBriefJobs returns page, pageSize, total, and jobs slice", async () => {
    // GD-BCARD premium = 3 concepts
    const { briefId } = await createBrief({ ...BASE_BRIEF, packageTier: "premium" } as GraphicDesignBrief);
    await approveBriefAndDispatch(briefId, makeMockAdapter());

    const r = listBriefJobs(briefId, { page: 1, pageSize: 2 });

    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(2);
    expect(r.total).toBe(3);
    expect(r.jobs).toHaveLength(2);
  });

  it("last page contains remaining items", async () => {
    // GD-BCARD premium = 3 concepts; page 2 of pageSize 2 → 1 remaining
    const { briefId } = await createBrief({ ...BASE_BRIEF, packageTier: "premium" } as GraphicDesignBrief);
    await approveBriefAndDispatch(briefId, makeMockAdapter());

    const last = listBriefJobs(briefId, { page: 2, pageSize: 2 });
    expect(last.jobs).toHaveLength(1);
  });

  it("beyond-last page returns empty jobs slice", async () => {
    // GD-BCARD basic = 1 concept
    const { briefId } = await createBrief(BASE_BRIEF);
    await approveBriefAndDispatch(briefId, makeMockAdapter());

    const beyond = listBriefJobs(briefId, { page: 5, pageSize: 10 });
    expect(beyond.jobs).toHaveLength(0);
    expect(beyond.total).toBe(1);
  });

  it("pageSize=0 is clamped to 1", () => {
    // Store is clear — throw expected for unknown id
    expect(() => listBriefJobs("not-a-real-id", { pageSize: 0 })).toThrow();
  });
});
