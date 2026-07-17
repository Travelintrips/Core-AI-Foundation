/**
 * graphic-design/manifest.ts — Team 15
 *
 * Deliverable manifest factory.
 *
 * `buildDeliverableManifest(brief, tier, outputFormat)` returns the
 * authoritative list of files to produce for a given order, keyed by
 * `fileKey` (stable, machine-readable identifier).
 *
 * The manifest is stored in the job record and checked by the QC engine.
 * Every fileKey listed here must be present in the final package.
 */

import type { GdServiceCode, PackageTier, OutputFormat } from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeliverableFileFormat =
  | "pdf"        // print-ready PDF (CMYK, bleed included)
  | "pdf_digital" // screen PDF (RGB, no bleed)
  | "ai"         // Adobe Illustrator source
  | "eps"        // Encapsulated PostScript
  | "svg"        // Scalable Vector Graphics
  | "png"        // Raster, transparent background
  | "png_white"  // Raster, white background
  | "jpg"        // Raster, no transparency
  | "psd"        // Photoshop source
  | "indd"       // InDesign source (deliverable note only — we produce PDF)
  | "gif"        // Animated GIF
  | "mp4"        // Animated social asset
  | "zip";       // Package archive

export interface DeliverableFile {
  fileKey:      string;             // Unique stable ID (snake_case)
  label:        string;             // Human-readable description
  format:       DeliverableFileFormat;
  variant:      string;             // Blueprint variant name
  required:     boolean;            // false = nice-to-have
  description?: string;
}

export interface DeliverableManifest {
  serviceCode:   GdServiceCode;
  packageTier:   PackageTier;
  outputFormat:  OutputFormat;
  files:         DeliverableFile[];
  /** Total expected file count (required only). */
  requiredCount: number;
  /** ISO timestamp the manifest was created. */
  createdAt:     string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function file(
  fileKey: string,
  label: string,
  format: DeliverableFileFormat,
  variant: string,
  required = true,
  description?: string
): DeliverableFile {
  return { fileKey, label, format, variant, required, description };
}

// ── Manifest builders per service ─────────────────────────────────────────────

function logoManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("logo_svg_primary",   "Logo SVG – Primary (Color)",      "svg",       "primary_1000"),
    file("logo_pdf_vector",    "Logo PDF – Vector Print-Ready",   "pdf",       "primary_1000"),
    file("logo_png_1000",      "Logo PNG – 1000×1000 Color",      "png",       "primary_1000"),
    file("logo_png_500",       "Logo PNG – 500×500 Color",        "png",       "primary_500"),
    file("logo_png_white",     "Logo PNG – White on Transparent", "png_white", "primary_1000"),
    file("logo_png_black",     "Logo PNG – Black on Transparent", "png",       "primary_1000"),
    file("logo_horizontal",    "Logo PNG – Horizontal Layout",    "png",       "horizontal_1200x400"),
  ];

  if (tier === "standard" || tier === "premium") {
    base.push(
      file("logo_eps",         "Logo EPS – Vector (Illustrator)", "eps", "primary_1000", true),
      file("logo_favicon_32",  "Favicon – 32×32px",               "png", "favicon_32",   true),
      file("logo_favicon_512", "Favicon – 512×512px",             "png", "favicon_512",  true),
    );
  }

  if (tier === "premium") {
    base.push(
      file("logo_ai_source",    "Logo AI – Editable Source File",  "ai",  "primary_1000", true),
      file("logo_brand_guide",  "Mini Brand Guide (PDF)",          "pdf", "primary_1000", true,  "Color values, fonts, clear space rules"),
    );
  }

  return base;
}

function bcardManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("bcard_pdf_print",    "Business Card PDF – Print-Ready (CMYK + Bleed)", "pdf",       "standard_landscape"),
    file("bcard_png_preview",  "Business Card PNG – Preview (Front)",           "png",       "standard_landscape"),
    file("bcard_png_back",     "Business Card PNG – Preview (Back)",            "png",       "standard_landscape", false),
  ];
  if (tier === "standard" || tier === "premium") {
    base.push(file("bcard_pdf_digital", "Business Card PDF – Digital / Screen",     "pdf_digital", "digital_1050x600"));
  }
  if (tier === "premium") {
    base.push(
      file("bcard_ai_source",  "Business Card AI – Editable Source",            "ai",        "standard_landscape"),
      file("bcard_mockup_jpg", "Business Card Mockup (Lifestyle Photo)",         "jpg",       "standard_landscape", false, "3D mockup render"),
    );
  }
  return base;
}

function letterheadManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("ltrhead_pdf_print",  "Letterhead PDF – Print-Ready",              "pdf",       "a4_portrait"),
    file("ltrhead_png_preview","Letterhead PNG – Preview",                  "png",       "a4_portrait"),
  ];
  if (tier === "standard" || tier === "premium") {
    base.push(
      file("ltrhead_pdf_digital","Letterhead PDF – Digital (Screen)",       "pdf_digital", "a4_2480x3508"),
      file("ltrhead_docx_note", "Note: Editable DOCX template on request",  "pdf",       "a4_portrait", false, "Provided as brief note; Word template on request"),
    );
  }
  if (tier === "premium") {
    base.push(
      file("env_pdf_print",    "Envelope DL PDF – Print-Ready",             "pdf",       "envelope_dl"),
      file("complip_pdf",      "Complimentary Slip PDF – Print-Ready",      "pdf",       "complimentary"),
      file("ltrhead_ai",       "Letterhead AI – Editable Source",           "ai",        "a4_portrait"),
    );
  }
  return base;
}

function flyerManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("flyer_pdf_print",    "Flyer PDF – Print-Ready (CMYK + Bleed)",    "pdf",       "a5_portrait"),
    file("flyer_png_preview",  "Flyer PNG – Preview",                       "png",       "a5_portrait"),
    file("flyer_jpg_social",   "Flyer JPG – Social Media Share",            "jpg",       "a5_digital"),
  ];
  if (tier === "premium") {
    base.push(file("flyer_ai", "Flyer AI – Editable Source",                "ai",        "a5_portrait"));
  }
  return base;
}

function posterManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("poster_pdf_print",   "Poster PDF – Print-Ready",                  "pdf",       "a3_portrait"),
    file("poster_png_preview", "Poster PNG – Preview (72dpi)",              "png",       "a3_digital"),
    file("poster_jpg_web",     "Poster JPG – Web Share",                    "jpg",       "web_1080x1920"),
  ];
  if (tier === "standard" || tier === "premium") {
    base.push(file("poster_pdf_digital", "Poster PDF – Digital (Screen)",   "pdf_digital", "a3_digital"));
  }
  if (tier === "premium") {
    base.push(
      file("poster_ai",        "Poster AI – Editable Source",               "ai",        "a3_portrait"),
      file("poster_mockup",    "Poster Mockup JPG (Frame / Wall)",          "jpg",       "a3_portrait", false),
    );
  }
  return base;
}

function bannerManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("banner_pdf_print",   "Banner PDF – Print-Ready",                  "pdf",       "rollup_85x200"),
    file("banner_png_preview", "Banner PNG – Preview",                      "png",       "rollup_85x200"),
  ];
  if (tier === "standard" || tier === "premium") {
    base.push(
      file("banner_jpg_web",   "Banner JPG – Web / Digital",                "jpg",       "fb_cover_1920x630"),
      file("banner_leaderboard","Banner PNG – IAB Leaderboard 728×90",      "png",       "leaderboard_728x90", false),
    );
  }
  if (tier === "premium") {
    base.push(
      file("banner_ai",        "Banner AI – Editable Source",               "ai",        "rollup_85x200"),
      file("banner_mockup",    "Banner Mockup JPG",                         "jpg",       "rollup_85x200", false),
    );
  }
  return base;
}

function brochureManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("brochure_pdf_print", "Brochure PDF – Print-Ready (CMYK + Bleed)", "pdf",       "trifold_a4"),
    file("brochure_png_cover", "Brochure PNG – Cover Preview",              "png",       "trifold_a4"),
    file("brochure_pdf_digital","Brochure PDF – Digital (Flat)",            "pdf_digital","a4_digital"),
  ];
  if (tier === "premium") {
    base.push(
      file("brochure_ai",      "Brochure AI – Editable Source",             "ai",        "trifold_a4"),
      file("brochure_mockup",  "Brochure Mockup JPG",                       "jpg",       "trifold_a4", false),
    );
  }
  return base;
}

function socialManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("social_ig_post_png",   "Instagram Post PNG (1080×1080)",          "png", "ig_post_1080x1080"),
    file("social_ig_story_png",  "Instagram Story PNG (1080×1920)",         "png", "ig_story_1080x1920"),
    file("social_fb_post_png",   "Facebook Post PNG (1200×628)",            "png", "fb_post_1200x628"),
    file("social_fb_cover_png",  "Facebook Cover PNG (1920×630)",           "png", "fb_cover_1920x630"),
    file("social_yt_thumb_png",  "YouTube Thumbnail PNG (1280×720)",        "png", "yt_thumbnail_1280x720"),
    file("social_linkedin_png",  "LinkedIn Post PNG (1200×627)",            "png", "linkedin_post_1200x627"),
  ];
  if (tier === "standard" || tier === "premium") {
    base.push(
      file("social_tiktok_png",  "TikTok Post PNG (1080×1920)",             "png", "tiktok_post_1080x1920"),
      file("social_highlight",   "Instagram Highlight Icon PNG (400×400)",  "png", "highlight_icon_400x400"),
      file("social_carousel_png","Instagram Carousel Slide PNG",            "png", "ig_carousel_1080x1080"),
      file("social_zip",         "Social Media Kit ZIP Archive",            "zip", "ig_post_1080x1080"),
    );
  }
  if (tier === "premium") {
    base.push(
      file("social_ai_source",   "Social Kit AI – Editable Templates",      "ai",  "ig_post_1080x1080"),
      file("social_yt_channel",  "YouTube Channel Art PNG (2560×1440)",     "png", "yt_channel_2560x1440"),
      file("social_animated_gif","Animated Story GIF",                      "gif", "ig_story_1080x1920", false),
    );
  }
  return base;
}

function certManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("cert_pdf_print",     "Certificate PDF – Print-Ready",             "pdf",       "a4_landscape"),
    file("cert_png_preview",   "Certificate PNG – Preview",                 "png",       "a4_landscape"),
    file("cert_pdf_digital",   "Certificate PDF – Digital / Screen",        "pdf_digital","a4_landscape_digital"),
  ];
  if (tier === "standard" || tier === "premium") {
    base.push(file("cert_jpg_share", "Certificate JPG – Social Share",      "jpg",       "a4_landscape"));
  }
  if (tier === "premium") {
    base.push(
      file("cert_ai",          "Certificate AI – Editable Template",        "ai",        "a4_landscape"),
      file("cert_pdf_blank",   "Certificate PDF – Blank (Print Run)",        "pdf",       "a4_landscape", false, "For bulk printing without recipient name pre-filled"),
    );
  }
  return base;
}

function stationeryManifest(tier: PackageTier, out: OutputFormat): DeliverableFile[] {
  const base: DeliverableFile[] = [
    file("stat_ltrhead_pdf",   "Letterhead PDF – Print-Ready",              "pdf", "letterhead_a4"),
    file("stat_env_pdf",       "Envelope DL PDF – Print-Ready",             "pdf", "envelope_dl"),
    file("stat_bcard_pdf",     "Business Card PDF – Print-Ready",           "pdf", "business_card"),
    file("stat_ltrhead_png",   "Letterhead PNG – Preview",                  "png", "letterhead_a4"),
    file("stat_zip",           "Stationery Suite ZIP Archive",              "zip", "letterhead_a4"),
  ];
  if (tier === "standard" || tier === "premium") {
    base.push(
      file("stat_notepad_pdf", "Notepad A5 PDF – Print-Ready",              "pdf", "notepad_a5"),
      file("stat_folder_pdf",  "Presentation Folder PDF – Print-Ready",     "pdf", "folder_a4"),
    );
  }
  if (tier === "premium") {
    base.push(
      file("stat_ai_source",   "Stationery AI – Editable Source Files",     "ai",  "letterhead_a4"),
      file("stat_mockup_jpg",  "Stationery Mockup JPG (Flatlay)",           "jpg", "letterhead_a4", false),
    );
  }
  return base;
}

// ── Builder map ───────────────────────────────────────────────────────────────

const BUILDERS: Record<GdServiceCode, (tier: PackageTier, out: OutputFormat) => DeliverableFile[]> = {
  "GD-LOGO":       logoManifest,
  "GD-BCARD":      bcardManifest,
  "GD-LTRHEAD":    letterheadManifest,
  "GD-FLYER":      flyerManifest,
  "GD-POSTER":     posterManifest,
  "GD-BANNER":     bannerManifest,
  "GD-BROCHURE":   brochureManifest,
  "GD-SOCIAL":     socialManifest,
  "GD-CERT":       certManifest,
  "GD-STATIONERY": stationeryManifest,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function buildDeliverableManifest(
  serviceCode: GdServiceCode,
  packageTier: PackageTier,
  outputFormat: OutputFormat
): DeliverableManifest {
  const builder = BUILDERS[serviceCode];
  if (!builder) throw new Error(`No manifest builder for service: ${serviceCode}`);

  const files = builder(packageTier, outputFormat).filter((f) => {
    // Filter by output format: skip pure print PDFs for digital-only orders.
    if (outputFormat === "digital" && f.format === "pdf" && !f.fileKey.includes("digital")) return false;
    if (outputFormat === "print" && (f.format === "gif" || f.format === "mp4")) return false;
    return true;
  });

  return {
    serviceCode,
    packageTier,
    outputFormat,
    files,
    requiredCount: files.filter((f) => f.required).length,
    createdAt: new Date().toISOString(),
  };
}

/** Return only the required file formats (for QC's expectedFormats input). */
export function getRequiredFormats(
  serviceCode: GdServiceCode,
  packageTier: PackageTier,
  outputFormat: OutputFormat
): string[] {
  const manifest = buildDeliverableManifest(serviceCode, packageTier, outputFormat);
  return [...new Set(manifest.files.filter((f) => f.required).map((f) => f.format))];
}
