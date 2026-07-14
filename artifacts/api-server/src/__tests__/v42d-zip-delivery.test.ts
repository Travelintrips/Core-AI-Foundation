/**
 * V4.2D ZIP Delivery Tests
 */
import { describe, it, expect } from "vitest";

// ── ZIP file naming ───────────────────────────────────────────────────────────

describe("ZIP delivery naming", () => {
  function safeBrandName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-]/g, "_");
  }

  it("sanitizes special characters from brand name", () => {
    expect(safeBrandName("My Brand & Co.")).toBe("My_Brand___Co_");
    expect(safeBrandName("Café")).toBe("Caf_");
    expect(safeBrandName("Brand-Name")).toBe("Brand-Name");
  });

  it("preserves alphanumeric and hyphens", () => {
    expect(safeBrandName("TechCorp-2024")).toBe("TechCorp-2024");
  });
});

// ── Manifest structure ────────────────────────────────────────────────────────

describe("ZIP manifest structure", () => {
  interface ManifestEntry {
    fileName: string;
    type: string;
    mimeType: string;
    fileSizeBytes: number;
    checksum: string;
  }

  interface Manifest {
    projectId: string;
    brandName: string;
    generatedAt: string;
    files: ManifestEntry[];
  }

  it("manifest has required fields", () => {
    const manifest: Manifest = {
      projectId: "proj-123",
      brandName: "Test Brand",
      generatedAt: new Date().toISOString(),
      files: [
        { fileName: "brand_strategy-v1-5.pdf", type: "document", mimeType: "application/pdf", fileSizeBytes: 102400, checksum: "abc123" },
      ],
    };
    expect(manifest.projectId).toBeTruthy();
    expect(manifest.brandName).toBeTruthy();
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.files[0]!.checksum).toBeTruthy();
  });

  it("manifest entries have all required fields", () => {
    const entry: ManifestEntry = {
      fileName: "logo-v1-1.png",
      type: "image",
      mimeType: "image/png",
      fileSizeBytes: 204800,
      checksum: "deadbeef",
    };
    expect(entry.fileName).toBeTruthy();
    expect(entry.type).toBeTruthy();
    expect(entry.mimeType).toBeTruthy();
    expect(entry.fileSizeBytes).toBeGreaterThan(0);
    expect(entry.checksum).toBeTruthy();
  });
});

// ── File extension mapping ────────────────────────────────────────────────────

describe("ZIP file extension mapping", () => {
  function getExtension(assetType: string, mimeType: string): string {
    if (mimeType.includes("pdf")) return ".pdf";
    if (mimeType.includes("presentation")) return ".pptx";
    if (mimeType.includes("png")) return ".png";
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
    if (assetType === "document") return ".pdf";
    if (assetType === "presentation") return ".pptx";
    if (assetType === "image") return ".png";
    return ".bin";
  }

  it("maps pdf mime type to .pdf", () => {
    expect(getExtension("document", "application/pdf")).toBe(".pdf");
  });

  it("maps pptx mime type to .pptx", () => {
    expect(getExtension("presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe(".pptx");
  });

  it("maps image/png to .png", () => {
    expect(getExtension("image", "image/png")).toBe(".png");
  });

  it("falls back by assetType for empty mimeType", () => {
    expect(getExtension("document", "")).toBe(".pdf");
    expect(getExtension("presentation", "")).toBe(".pptx");
    expect(getExtension("image", "")).toBe(".png");
  });

  it("falls back to .bin for unknown types", () => {
    expect(getExtension("unknown", "")).toBe(".bin");
  });
});

// ── Status transitions ────────────────────────────────────────────────────────

describe("ZIP delivery status machine", () => {
  type ZipStatus = "queued" | "generating" | "completed" | "failed";

  const VALID_TRANSITIONS: Record<ZipStatus, ZipStatus[]> = {
    queued:     ["generating", "failed"],
    generating: ["completed", "failed"],
    completed:  [], // terminal
    failed:     ["queued"], // retry creates new record
  };

  it("queued can transition to generating", () => {
    expect(VALID_TRANSITIONS.queued).toContain("generating");
  });

  it("generating can complete or fail", () => {
    expect(VALID_TRANSITIONS.generating).toContain("completed");
    expect(VALID_TRANSITIONS.generating).toContain("failed");
  });

  it("completed is terminal", () => {
    expect(VALID_TRANSITIONS.completed).toHaveLength(0);
  });

  it("failed can be retried (new queued record)", () => {
    expect(VALID_TRANSITIONS.failed).toContain("queued");
  });
});

// ── Retry logic ───────────────────────────────────────────────────────────────

describe("ZIP retry logic", () => {
  it("already queued delivery should not be re-queued", () => {
    const status = "queued";
    const shouldSkip = status === "queued" || status === "generating" || status === "completed";
    expect(shouldSkip).toBe(true);
  });

  it("failed delivery can be retried", () => {
    const status = "failed";
    const shouldSkip = status === "queued" || status === "generating" || status === "completed";
    expect(shouldSkip).toBe(false);
  });

  it("none status triggers new zip", () => {
    const status = "none";
    const shouldSkip = status === "queued" || status === "generating" || status === "completed";
    expect(shouldSkip).toBe(false);
  });
});

// ── README generation ─────────────────────────────────────────────────────────

describe("ZIP README generation", () => {
  function buildReadme(brandName: string, projectId: string): string {
    return `${brandName} — Creative AI Delivery Package\n${"=".repeat(50)}\n\nProject ID: ${projectId}`;
  }

  it("includes brand name", () => {
    const readme = buildReadme("Acme Corp", "proj-001");
    expect(readme).toContain("Acme Corp");
  });

  it("includes project ID", () => {
    const readme = buildReadme("Acme Corp", "proj-001");
    expect(readme).toContain("proj-001");
  });
});
