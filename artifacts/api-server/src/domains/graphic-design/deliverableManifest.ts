/**
 * deliverableManifest.ts — Graphic Design Domain (Team 15)
 *
 * Builds and validates the deliverable manifest for each Graphic Design service.
 * The manifest is embedded in the ZIP package and stored in gd_requests.manifest_json.
 *
 * Pattern follows zipDeliveryService.ts ZipManifest shape.
 */

import type {
  GraphicDesignServiceCode,
  GdPackageTier,
  GdDeliverableEntry,
  GdDeliverableManifest,
  PrintSpec,
} from "./types.js";
import { GD_PRINT_SPECS } from "./blueprintMapping.js";

// ── Expected deliverables per service (from team-15.json manifest) ───────────

interface DeliverableTemplate {
  fileName: string;
  purpose: GdDeliverableEntry["purpose"];
  mimeType: string;
  widthPx?: number;
  heightPx?: number;
  tiers: GdPackageTier[];   // which tiers include this deliverable
}

const GD_DELIVERABLE_TEMPLATES: Record<GraphicDesignServiceCode, DeliverableTemplate[]> = {
  "logo": [
    { fileName: "logo-primary.svg",       purpose: "primary",   mimeType: "image/svg+xml",       tiers: ["starter","professional","business","enterprise"] },
    { fileName: "logo-primary.png",       purpose: "export",    mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"], widthPx: 1024, heightPx: 1024 },
    { fileName: "logo-horizontal.png",    purpose: "variant",   mimeType: "image/png",            tiers: ["professional","business","enterprise"], widthPx: 2048, heightPx: 512 },
    { fileName: "logo-icon.png",          purpose: "variant",   mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"], widthPx: 512, heightPx: 512 },
    { fileName: "logo-white.png",         purpose: "variant",   mimeType: "image/png",            tiers: ["professional","business","enterprise"], widthPx: 1024, heightPx: 1024 },
    { fileName: "logo-black.png",         purpose: "variant",   mimeType: "image/png",            tiers: ["professional","business","enterprise"], widthPx: 1024, heightPx: 1024 },
    { fileName: "logo-primary.eps",       purpose: "source",    mimeType: "application/postscript", tiers: ["business","enterprise"] },
    { fileName: "brand-colors.json",      purpose: "source",    mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "usage-guidelines.pdf",   purpose: "export",    mimeType: "application/pdf",      tiers: ["enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "business-card": [
    { fileName: "business-card-front.pdf", purpose: "primary",  mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "business-card-back.pdf",  purpose: "variant",  mimeType: "application/pdf",      tiers: ["professional","business","enterprise"] },
    { fileName: "business-card-preview.png",purpose:"thumbnail",mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "business-card.ai",        purpose: "source",   mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "manifest.json",           purpose: "manifest", mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",          purpose: "qc",       mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "letterhead": [
    { fileName: "letterhead.pdf",         purpose: "primary",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "letterhead.docx",        purpose: "export",    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", tiers: ["professional","business","enterprise"] },
    { fileName: "letterhead-preview.png", purpose: "thumbnail", mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "letterhead.ai",          purpose: "source",    mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "flyer": [
    { fileName: "flyer-front.pdf",        purpose: "primary",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "flyer-back.pdf",         purpose: "variant",   mimeType: "application/pdf",      tiers: ["professional","business","enterprise"] },
    { fileName: "flyer-preview.png",      purpose: "thumbnail", mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "flyer.ai",               purpose: "source",    mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "flyer-digital.jpg",      purpose: "export",    mimeType: "image/jpeg",           tiers: ["professional","business","enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "poster": [
    { fileName: "poster.pdf",             purpose: "primary",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "poster-preview.png",     purpose: "thumbnail", mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "poster-digital.jpg",     purpose: "export",    mimeType: "image/jpeg",           tiers: ["professional","business","enterprise"] },
    { fileName: "poster-a3.pdf",          purpose: "variant",   mimeType: "application/pdf",      tiers: ["business","enterprise"] },
    { fileName: "poster.ai",              purpose: "source",    mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "banner": [
    { fileName: "banner-rollup.pdf",      purpose: "primary",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "banner-horizontal.pdf",  purpose: "variant",   mimeType: "application/pdf",      tiers: ["professional","business","enterprise"] },
    { fileName: "banner-preview.png",     purpose: "thumbnail", mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "banner.ai",              purpose: "source",    mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "brochure": [
    { fileName: "brochure.pdf",           purpose: "primary",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "brochure-preview.png",   purpose: "thumbnail", mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "brochure-digital.pdf",   purpose: "export",    mimeType: "application/pdf",      tiers: ["professional","business","enterprise"] },
    { fileName: "brochure-spreads.pdf",   purpose: "variant",   mimeType: "application/pdf",      tiers: ["business","enterprise"] },
    { fileName: "brochure.ai",            purpose: "source",    mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "social-media": [
    { fileName: "instagram-post.png",     purpose: "primary",   mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"], widthPx: 1080, heightPx: 1080 },
    { fileName: "instagram-story.png",    purpose: "variant",   mimeType: "image/png",            tiers: ["professional","business","enterprise"], widthPx: 1080, heightPx: 1920 },
    { fileName: "facebook-cover.png",     purpose: "variant",   mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"], widthPx: 851, heightPx: 315 },
    { fileName: "facebook-post.png",      purpose: "variant",   mimeType: "image/png",            tiers: ["professional","business","enterprise"], widthPx: 1200, heightPx: 630 },
    { fileName: "linkedin-banner.png",    purpose: "variant",   mimeType: "image/png",            tiers: ["professional","business","enterprise"], widthPx: 1584, heightPx: 396 },
    { fileName: "twitter-header.png",     purpose: "variant",   mimeType: "image/png",            tiers: ["business","enterprise"], widthPx: 1500, heightPx: 500 },
    { fileName: "tiktok-cover.png",       purpose: "variant",   mimeType: "image/png",            tiers: ["enterprise"], widthPx: 1080, heightPx: 1920 },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "certificate": [
    { fileName: "certificate.pdf",        purpose: "primary",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "certificate-preview.png",purpose: "thumbnail", mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "certificate-blank.pdf",  purpose: "export",    mimeType: "application/pdf",      tiers: ["professional","business","enterprise"] },
    { fileName: "certificate.ai",         purpose: "source",    mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
  "stationery": [
    { fileName: "letterhead.pdf",         purpose: "primary",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "business-card-front.pdf",purpose: "variant",   mimeType: "application/pdf",      tiers: ["starter","professional","business","enterprise"] },
    { fileName: "business-card-back.pdf", purpose: "variant",   mimeType: "application/pdf",      tiers: ["professional","business","enterprise"] },
    { fileName: "envelope-dl.pdf",        purpose: "variant",   mimeType: "application/pdf",      tiers: ["professional","business","enterprise"] },
    { fileName: "with-compliments.pdf",   purpose: "variant",   mimeType: "application/pdf",      tiers: ["business","enterprise"] },
    { fileName: "notepad-cover.pdf",      purpose: "variant",   mimeType: "application/pdf",      tiers: ["enterprise"] },
    { fileName: "stationery-preview.png", purpose: "thumbnail", mimeType: "image/png",            tiers: ["starter","professional","business","enterprise"] },
    { fileName: "stationery.ai",          purpose: "source",    mimeType: "application/postscript",tiers: ["business","enterprise"] },
    { fileName: "manifest.json",          purpose: "manifest",  mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
    { fileName: "qc-report.json",         purpose: "qc",        mimeType: "application/json",     tiers: ["starter","professional","business","enterprise"] },
  ],
};

// ── Manifest builder ──────────────────────────────────────────────────────────

interface BuildManifestInput {
  gdRequestId: number;
  serviceCode: GraphicDesignServiceCode;
  packageTier: GdPackageTier;
  tenantId: string;
  producedFiles: Array<{
    fileName: string;
    storagePath?: string;
    fileSizeBytes?: number;
    checksumSha256?: string;
    widthPx?: number;
    heightPx?: number;
  }>;
  qcSummary: { score: number; passed: boolean; warnings: string[] };
}

/**
 * Build the deliverable manifest for a completed Graphic Design job.
 * Only includes files that are expected for the given tier AND were actually produced.
 */
export function buildGdManifest(input: BuildManifestInput): GdDeliverableManifest {
  const {
    gdRequestId, serviceCode, packageTier, tenantId, producedFiles, qcSummary,
  } = input;

  const templates = GD_DELIVERABLE_TEMPLATES[serviceCode] ?? [];
  const tierTemplates = templates.filter((t) => t.tiers.includes(packageTier));

  const producedMap = new Map(producedFiles.map((f) => [f.fileName, f]));

  const deliverables: GdDeliverableEntry[] = tierTemplates
    .filter((t) => producedMap.has(t.fileName))
    .map((t) => {
      const produced = producedMap.get(t.fileName)!;
      return {
        fileName:        t.fileName,
        purpose:         t.purpose,
        mimeType:        t.mimeType,
        storagePath:     produced.storagePath,
        fileSizeBytes:   produced.fileSizeBytes,
        checksumSha256:  produced.checksumSha256,
        widthPx:         produced.widthPx ?? t.widthPx,
        heightPx:        produced.heightPx ?? t.heightPx,
      };
    });

  const spec = GD_PRINT_SPECS[serviceCode];

  return {
    version: "1.0",
    gdRequestId,
    serviceCode,
    packageTier,
    exportedAt: new Date().toISOString(),
    tenantId,
    deliverables,
    printSpec: spec.digitalOnly ? null : spec,
    qcSummary,
  };
}

/**
 * Get expected file names for a service at a given tier.
 * Useful in tests and QC checks.
 */
export function getExpectedFileNames(
  serviceCode: GraphicDesignServiceCode,
  packageTier: GdPackageTier,
): string[] {
  const templates = GD_DELIVERABLE_TEMPLATES[serviceCode] ?? [];
  return templates
    .filter((t) => t.tiers.includes(packageTier))
    .map((t) => t.fileName);
}

/** Export the raw template map for use in tests. */
export { GD_DELIVERABLE_TEMPLATES };
