/**
 * blueprintMapping.ts — Graphic Design Domain (Team 15)
 *
 * Maps each Graphic Design service to:
 *   - The rendering engine team (Team 9 image-gen, Team 10 template-engine, Team 11 pdf-export)
 *   - The job type registered in JOB_COMPLETION_REQUIREMENTS
 *   - The AI prompt template name
 *   - Print production specification
 *
 * Port interfaces to Team 7–14 are declared here. No renderer is implemented.
 */

import type { GraphicDesignServiceCode, GdBlueprint, PrintSpec } from "./types.js";

// ── Print specifications per service ─────────────────────────────────────────

export const GD_PRINT_SPECS: Record<GraphicDesignServiceCode, PrintSpec> = {
  "logo": {
    widthMm: 0, heightMm: 0, bleedMm: 0, safeAreaMm: 0,
    resolutionDpi: 300, colorMode: "rgb", digitalOnly: true,
  },
  "business-card": {
    widthMm: 88.9, heightMm: 50.8, bleedMm: 3.175, safeAreaMm: 3.175,
    resolutionDpi: 300, colorMode: "cmyk", digitalOnly: false,
  },
  "letterhead": {
    widthMm: 210, heightMm: 297, bleedMm: 3, safeAreaMm: 10,
    resolutionDpi: 300, colorMode: "cmyk", digitalOnly: false,
  },
  "flyer": {
    widthMm: 210, heightMm: 297, bleedMm: 3, safeAreaMm: 5,
    resolutionDpi: 300, colorMode: "cmyk", digitalOnly: false,
  },
  "poster": {
    widthMm: 420, heightMm: 594, bleedMm: 5, safeAreaMm: 10,
    resolutionDpi: 300, colorMode: "cmyk", digitalOnly: false,
  },
  "banner": {
    widthMm: 850, heightMm: 2000, bleedMm: 10, safeAreaMm: 50,
    resolutionDpi: 150, colorMode: "cmyk", digitalOnly: false,
  },
  "brochure": {
    widthMm: 210, heightMm: 297, bleedMm: 3, safeAreaMm: 5,
    resolutionDpi: 300, colorMode: "cmyk", digitalOnly: false,
  },
  "social-media": {
    widthMm: 0, heightMm: 0, bleedMm: 0, safeAreaMm: 0,
    resolutionDpi: 72, colorMode: "rgb", digitalOnly: true,
  },
  "certificate": {
    widthMm: 297, heightMm: 210, bleedMm: 3, safeAreaMm: 10,
    resolutionDpi: 300, colorMode: "cmyk", digitalOnly: false,
  },
  "stationery": {
    widthMm: 210, heightMm: 297, bleedMm: 3, safeAreaMm: 10,
    resolutionDpi: 300, colorMode: "cmyk", digitalOnly: false,
  },
};

// ── Blueprint registry ────────────────────────────────────────────────────────

/**
 * Job types must match keys in JOB_COMPLETION_REQUIREMENTS
 * (artifacts/api-server/src/services/jobCompletionGuard.ts).
 * Port to Team 14 (job-dispatch) via these job type strings.
 */
export const GD_BLUEPRINTS: Record<GraphicDesignServiceCode, GdBlueprint> = {
  "logo": {
    serviceCode: "logo",
    engineTeam: 9,                    // Team 9: image-generation
    jobType: "gd_logo_generation",
    promptTemplate: "gd-logo-v1",
  },
  "business-card": {
    serviceCode: "business-card",
    engineTeam: 10,                   // Team 10: template-engine
    jobType: "gd_business_card_render",
    promptTemplate: "gd-business-card-v1",
  },
  "letterhead": {
    serviceCode: "letterhead",
    engineTeam: 10,
    jobType: "gd_letterhead_render",
    promptTemplate: "gd-letterhead-v1",
  },
  "flyer": {
    serviceCode: "flyer",
    engineTeam: 10,
    jobType: "gd_flyer_render",
    promptTemplate: "gd-flyer-v1",
  },
  "poster": {
    serviceCode: "poster",
    engineTeam: 9,                    // image-gen for visual-heavy posters
    jobType: "gd_poster_generation",
    promptTemplate: "gd-poster-v1",
  },
  "banner": {
    serviceCode: "banner",
    engineTeam: 10,
    jobType: "gd_banner_render",
    promptTemplate: "gd-banner-v1",
  },
  "brochure": {
    serviceCode: "brochure",
    engineTeam: 11,                   // Team 11: pdf-export (multi-page)
    jobType: "gd_brochure_export",
    promptTemplate: "gd-brochure-v1",
  },
  "social-media": {
    serviceCode: "social-media",
    engineTeam: 9,
    jobType: "gd_social_media_generation",
    promptTemplate: "gd-social-media-v1",
  },
  "certificate": {
    serviceCode: "certificate",
    engineTeam: 11,
    jobType: "gd_certificate_export",
    promptTemplate: "gd-certificate-v1",
  },
  "stationery": {
    serviceCode: "stationery",
    engineTeam: 10,
    jobType: "gd_stationery_render",
    promptTemplate: "gd-stationery-v1",
  },
};

/**
 * Look up the blueprint for a service. Throws if the code is unknown.
 */
export function getGdBlueprint(serviceCode: GraphicDesignServiceCode): GdBlueprint {
  const bp = GD_BLUEPRINTS[serviceCode];
  if (!bp) throw new Error(`No blueprint registered for graphic-design service: '${serviceCode}'`);
  return bp;
}

/**
 * Look up print spec for a service.
 */
export function getGdPrintSpec(serviceCode: GraphicDesignServiceCode): PrintSpec {
  const spec = GD_PRINT_SPECS[serviceCode];
  if (!spec) throw new Error(`No print spec registered for graphic-design service: '${serviceCode}'`);
  return spec;
}

// ── Port interface descriptors (Team 7–14) ────────────────────────────────────
//
// These describe the shape that each upstream team's service expects.
// Actual calls go through the job engine (Team 14). No direct imports from
// those teams' modules — only the contract shape is defined here.

export interface BrandDnaContext {            // Team 7
  tenantId: string;
  primaryColor: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  logoStoragePath?: string;
  tagline?: string;
}

export interface AssetIntelligenceResult {   // Team 8
  assetId: string;
  dominantColors: string[];
  suggestedPalette: string[];
  styleClassification: string;
}

export interface ImageGenerationJob {        // Team 9
  jobType: string;
  promptTemplate: string;
  briefContext: Record<string, unknown>;
  brandDna: BrandDnaContext;
  outputSizes: Array<{ widthPx: number; heightPx: number; label: string }>;
  tenantId: string;
  requestId: number;
}

export interface TemplateRenderRequest {     // Team 10
  jobType: string;
  promptTemplate: string;
  briefContext: Record<string, unknown>;
  brandDna: BrandDnaContext;
  printSpec: PrintSpec;
  tenantId: string;
  requestId: number;
}

export interface PdfExportJob {              // Team 11
  jobType: string;
  sourceHtml?: string;
  sourceData?: Record<string, unknown>;
  printSpec: PrintSpec;
  tenantId: string;
  requestId: number;
}

export interface ZipManifest {               // Team 12
  projectId: number;
  brandName: string;
  items: Array<{ fileName: string; storagePath: string; mimeType: string; checksum?: string }>;
}

export interface QcRunResult {               // Team 13
  qcScore: number;
  passed: boolean;
  dimensions: Record<string, number | boolean>;
  warnings: string[];
}

export interface JobDispatchRequest {        // Team 14
  jobType: string;
  tenantId: string;
  requestId: number;
  payload: Record<string, unknown>;
  priority?: number;
}
