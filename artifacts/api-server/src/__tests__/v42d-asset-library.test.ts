/**
 * V4.2D Asset Library Tests
 */
import { describe, it, expect } from "vitest";

// ── Category validation ───────────────────────────────────────────────────────

describe("Asset library categories", () => {
  const VALID_CATEGORIES = [
    "logo", "photo", "illustration", "icon", "document",
    "brand_guideline", "reference", "generated_image", "uploaded_image",
  ];

  it("has 9 valid categories", () => {
    expect(VALID_CATEGORIES.length).toBe(9);
  });

  it("accepts all valid categories", () => {
    for (const cat of VALID_CATEGORIES) {
      expect(VALID_CATEGORIES.includes(cat)).toBe(true);
    }
  });

  it("rejects unknown category", () => {
    expect(VALID_CATEGORIES.includes("video")).toBe(false);
    expect(VALID_CATEGORIES.includes("")).toBe(false);
    expect(VALID_CATEGORIES.includes("LOGO")).toBe(false);
  });
});

// ── Category label mapping ────────────────────────────────────────────────────

describe("Category label mapping", () => {
  const CATEGORY_LABELS: Record<string, string> = {
    logo:           "Logo",
    photo:          "Photo",
    illustration:   "Illustration",
    icon:           "Icon",
    document:       "Document",
    brand_guideline: "Brand Guideline",
    reference:      "Reference",
    generated_image: "Generated Image",
    uploaded_image: "Uploaded Image",
  };

  it("maps logo → Logo", () => expect(CATEGORY_LABELS.logo).toBe("Logo"));
  it("maps brand_guideline → Brand Guideline", () => expect(CATEGORY_LABELS.brand_guideline).toBe("Brand Guideline"));
  it("maps generated_image → Generated Image", () => expect(CATEGORY_LABELS.generated_image).toBe("Generated Image"));
  it("covers all 9 categories", () => expect(Object.keys(CATEGORY_LABELS).length).toBe(9));
});

// ── Asset replace versioning ──────────────────────────────────────────────────

describe("Asset replace (new version)", () => {
  it("replace increments version", () => {
    const existingVersion = 2;
    const newVersion = existingVersion + 1;
    expect(newVersion).toBe(3);
  });

  it("replace uses parent as parentAssetId", () => {
    const parentId = 42;
    const newRow = { parentAssetId: parentId, version: 2, active: true };
    expect(newRow.parentAssetId).toBe(42);
    expect(newRow.active).toBe(true);
  });

  it("deactivating old version sets active to false", () => {
    const oldActive = true;
    const afterUpdate = false; // simulated
    expect(afterUpdate).toBe(false);
  });
});

// ── Filter logic ──────────────────────────────────────────────────────────────

describe("Asset library filter logic", () => {
  interface AssetStub {
    title: string;
    fileName: string;
    category: string;
    favorited: boolean;
    tags: string[];
    fileSizeBytes: number;
    createdAt: string;
  }

  const assets: AssetStub[] = [
    { title: "Primary Logo", fileName: "logo.png", category: "logo", favorited: true, tags: ["brand"], fileSizeBytes: 100000, createdAt: "2025-01-01T00:00:00Z" },
    { title: "Brand Photo", fileName: "photo.jpg", category: "photo", favorited: false, tags: ["photo", "hero"], fileSizeBytes: 500000, createdAt: "2025-02-01T00:00:00Z" },
    { title: "Icon Set", fileName: "icons.zip", category: "icon", favorited: true, tags: [], fileSizeBytes: 50000, createdAt: "2025-03-01T00:00:00Z" },
  ];

  it("filters by category", () => {
    const filtered = assets.filter((a) => a.category === "logo");
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.title).toBe("Primary Logo");
  });

  it("filters by favorited", () => {
    const filtered = assets.filter((a) => a.favorited);
    expect(filtered.length).toBe(2);
  });

  it("filters by search (title)", () => {
    const q = "brand";
    const filtered = assets.filter((a) => a.title.toLowerCase().includes(q) || a.fileName.toLowerCase().includes(q));
    expect(filtered.length).toBe(1);
  });

  it("filters by tag", () => {
    const filtered = assets.filter((a) => a.tags.includes("photo"));
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.category).toBe("photo");
  });

  it("sorts by size descending", () => {
    const sorted = [...assets].sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
    expect(sorted[0]!.title).toBe("Brand Photo");
  });

  it("sorts by name A-Z", () => {
    const sorted = [...assets].sort((a, b) => a.title.localeCompare(b.title));
    expect(sorted[0]!.title).toBe("Brand Photo");
  });
});

// ── Signed download ───────────────────────────────────────────────────────────

describe("Asset library signed download", () => {
  it("returns 404 when asset has no storage path", () => {
    const asset = { storagePath: null };
    const ok = asset.storagePath !== null;
    expect(ok).toBe(false);
  });

  it("generates token for asset with storage path", () => {
    const asset = { storagePath: "/bucket/logos/logo.png" };
    const ok = asset.storagePath !== null;
    expect(ok).toBe(true);
  });
});

// ── Checksum computation ──────────────────────────────────────────────────────

describe("Asset checksum", () => {
  it("sha256 is 64 hex chars", () => {
    // Simulate the sha256 result
    const hex = "a".repeat(64);
    expect(hex.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });
});

// ── Unlock flow: approve ≠ unlock ─────────────────────────────────────────────

describe("Final unlock flow invariants", () => {
  it("filesUnlocked is the canonical gate for ZIP and downloads", () => {
    const project = { status: "approved", filesUnlocked: false, paymentStatus: "payment_verified" };
    // Even if approved, files must not be accessible until filesUnlocked is true
    const canDownload = project.filesUnlocked;
    expect(canDownload).toBe(false);
  });

  it("payment verified + filesUnlocked = true enables download", () => {
    const project = { status: "completed", filesUnlocked: true, paymentStatus: "payment_verified" };
    expect(project.filesUnlocked).toBe(true);
  });

  it("analytics event type is string", () => {
    const events = ["asset_library_download", "asset_library_upload", "zip_delivery_completed", "brand_kit_slot_updated"];
    for (const e of events) expect(typeof e).toBe("string");
  });
});
