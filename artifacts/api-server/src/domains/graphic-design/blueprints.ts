/**
 * graphic-design/blueprints.ts — Team 15
 *
 * Blueprint mapping: canonical print/digital specifications per service variant.
 *
 * "Blueprint" = the authoritative canvas spec the renderer (Team 7-8) will use
 * to produce output. It encodes:
 *   - Physical dimensions (mm) for print
 *   - Pixel dimensions for digital
 *   - Bleed and safe-area margins
 *   - Required resolution (DPI)
 *   - Color mode (RGB | CMYK)
 *
 * Rule: all bleed/safe values are in mm for print specs, in pixels for digital.
 * DPI conversion: px = Math.round((mm / 25.4) * dpi)
 */

import type { GdServiceCode } from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrintSpec {
  widthMm:      number;
  heightMm:     number;
  bleedMm:      number;     // bleed added to ALL four sides (ISO standard: 3 mm)
  safeAreaMm:   number;     // inset from trim edge where critical content must live
  resolutionDpi: 72 | 150 | 300 | 600;
  colorMode:    "CMYK" | "RGB" | "both";
  /** Computed pixel dimensions at the specified DPI (including bleed). */
  widthPxWithBleed:  number;
  heightPxWithBleed: number;
  /** Computed pixel dimensions at trim (no bleed). */
  widthPxTrim:  number;
  heightPxTrim: number;
}

export interface DigitalSpec {
  widthPx:      number;
  heightPx:     number;
  resolutionDpi: 72 | 96 | 144 | 150 | 300;
  colorMode:    "RGB" | "sRGB";
  safeAreaPx:   number;     // inset from canvas edge
  bleedPx:      0;          // digital has no bleed
}

export interface ServiceBlueprint {
  serviceCode:       GdServiceCode;
  displayName:       string;
  medium:            "print" | "digital" | "both";
  printVariants:     Record<string, PrintSpec>;
  digitalVariants:   Record<string, DigitalSpec>;
  /** The variant used when no variant is specified. */
  defaultVariant:    string;
  supportedVariants: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert millimetres to pixels at a given DPI (rounded to nearest integer). */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

function makePrintSpec(
  widthMm: number,
  heightMm: number,
  opts: { bleedMm?: number; safeAreaMm?: number; dpi?: 72 | 150 | 300 | 600; colorMode?: "CMYK" | "RGB" | "both" } = {}
): PrintSpec {
  const { bleedMm = 3, safeAreaMm = 5, dpi = 300, colorMode = "CMYK" } = opts;
  return {
    widthMm,
    heightMm,
    bleedMm,
    safeAreaMm,
    resolutionDpi: dpi,
    colorMode,
    widthPxWithBleed:  mmToPx(widthMm + bleedMm * 2, dpi),
    heightPxWithBleed: mmToPx(heightMm + bleedMm * 2, dpi),
    widthPxTrim:       mmToPx(widthMm, dpi),
    heightPxTrim:      mmToPx(heightMm, dpi),
  };
}

function makeDigitalSpec(
  widthPx: number,
  heightPx: number,
  opts: { dpi?: 72 | 96 | 144 | 150 | 300; safeAreaPx?: number } = {}
): DigitalSpec {
  const { dpi = 72, safeAreaPx = 20 } = opts;
  return { widthPx, heightPx, resolutionDpi: dpi, colorMode: "sRGB", safeAreaPx, bleedPx: 0 };
}

// ── Blueprints ─────────────────────────────────────────────────────────────────

const BLUEPRINTS: Record<GdServiceCode, ServiceBlueprint> = {

  // ── GD-LOGO ─────────────────────────────────────────────────────────────────
  "GD-LOGO": {
    serviceCode: "GD-LOGO",
    displayName: "Logo Concept",
    medium: "both",
    printVariants: {},
    digitalVariants: {
      "primary_1000":        makeDigitalSpec(1000, 1000, { dpi: 96, safeAreaPx: 40 }),
      "primary_500":         makeDigitalSpec(500, 500, { dpi: 96, safeAreaPx: 20 }),
      "horizontal_1200x400": makeDigitalSpec(1200, 400, { dpi: 96, safeAreaPx: 20 }),
      "favicon_32":          makeDigitalSpec(32, 32, { dpi: 96, safeAreaPx: 2 }),
      "favicon_512":         makeDigitalSpec(512, 512, { dpi: 96, safeAreaPx: 20 }),
    },
    defaultVariant:    "primary_1000",
    supportedVariants: ["primary_1000", "primary_500", "horizontal_1200x400", "favicon_32", "favicon_512"],
  },

  // ── GD-BCARD ────────────────────────────────────────────────────────────────
  "GD-BCARD": {
    serviceCode: "GD-BCARD",
    displayName: "Business Card",
    medium: "both",
    printVariants: {
      "standard_landscape":  makePrintSpec(90, 55),
      "standard_portrait":   makePrintSpec(55, 90),
      "square":              makePrintSpec(60, 60),
      "mini_landscape":      makePrintSpec(85, 50),
      "euro_landscape":      makePrintSpec(85, 55),
      "us_landscape":        makePrintSpec(88.9, 50.8),
    },
    digitalVariants: {
      "digital_1050x600":    makeDigitalSpec(1050, 600, { dpi: 96, safeAreaPx: 30 }),
    },
    defaultVariant:    "standard_landscape",
    supportedVariants: ["standard_landscape", "standard_portrait", "square", "mini_landscape", "euro_landscape", "us_landscape", "digital_1050x600"],
  },

  // ── GD-LTRHEAD ──────────────────────────────────────────────────────────────
  "GD-LTRHEAD": {
    serviceCode: "GD-LTRHEAD",
    displayName: "Letterhead",
    medium: "both",
    printVariants: {
      "a4_portrait":    makePrintSpec(210, 297),
      "letter_portrait": makePrintSpec(215.9, 279.4),
      "legal_portrait": makePrintSpec(215.9, 355.6),
      "envelope_dl":    makePrintSpec(220, 110, { bleedMm: 3, safeAreaMm: 8 }),
      "complimentary":  makePrintSpec(210, 100, { bleedMm: 3, safeAreaMm: 5 }),
    },
    digitalVariants: {
      "a4_2480x3508":   makeDigitalSpec(2480, 3508, { dpi: 150, safeAreaPx: 60 }),
    },
    defaultVariant:    "a4_portrait",
    supportedVariants: ["a4_portrait", "letter_portrait", "legal_portrait", "envelope_dl", "complimentary", "a4_2480x3508"],
  },

  // ── GD-FLYER ────────────────────────────────────────────────────────────────
  "GD-FLYER": {
    serviceCode: "GD-FLYER",
    displayName: "Flyer",
    medium: "both",
    printVariants: {
      "a4_portrait":   makePrintSpec(210, 297),
      "a4_landscape":  makePrintSpec(297, 210),
      "a5_portrait":   makePrintSpec(148, 210),
      "a5_landscape":  makePrintSpec(210, 148),
      "a6_portrait":   makePrintSpec(105, 148),
      "dl_portrait":   makePrintSpec(99, 210),
      "letter_portrait": makePrintSpec(215.9, 279.4),
      "square_210":    makePrintSpec(210, 210),
    },
    digitalVariants: {
      "a4_digital":    makeDigitalSpec(2480, 3508, { dpi: 150, safeAreaPx: 60 }),
      "a5_digital":    makeDigitalSpec(1748, 2480, { dpi: 150, safeAreaPx: 40 }),
    },
    defaultVariant:    "a5_portrait",
    supportedVariants: ["a4_portrait", "a4_landscape", "a5_portrait", "a5_landscape", "a6_portrait", "dl_portrait", "letter_portrait", "square_210", "a4_digital", "a5_digital"],
  },

  // ── GD-POSTER ───────────────────────────────────────────────────────────────
  "GD-POSTER": {
    serviceCode: "GD-POSTER",
    displayName: "Poster",
    medium: "both",
    printVariants: {
      "a0_portrait":   makePrintSpec(841, 1189, { bleedMm: 5, safeAreaMm: 10, dpi: 150 }),
      "a1_portrait":   makePrintSpec(594, 841, { bleedMm: 5, safeAreaMm: 8, dpi: 150 }),
      "a2_portrait":   makePrintSpec(420, 594, { bleedMm: 3, safeAreaMm: 8, dpi: 300 }),
      "a3_portrait":   makePrintSpec(297, 420, { bleedMm: 3, safeAreaMm: 5, dpi: 300 }),
      "a4_portrait":   makePrintSpec(210, 297, { bleedMm: 3, safeAreaMm: 5, dpi: 300 }),
      "b1_portrait":   makePrintSpec(707, 1000, { bleedMm: 5, safeAreaMm: 10, dpi: 150 }),
      "b2_portrait":   makePrintSpec(500, 707, { bleedMm: 3, safeAreaMm: 8, dpi: 300 }),
    },
    digitalVariants: {
      "a3_digital":    makeDigitalSpec(3508, 4961, { dpi: 150, safeAreaPx: 80 }),
      "web_1080x1920": makeDigitalSpec(1080, 1920, { dpi: 72, safeAreaPx: 40 }),
    },
    defaultVariant:    "a3_portrait",
    supportedVariants: ["a0_portrait", "a1_portrait", "a2_portrait", "a3_portrait", "a4_portrait", "b1_portrait", "b2_portrait", "a3_digital", "web_1080x1920"],
  },

  // ── GD-BANNER ───────────────────────────────────────────────────────────────
  "GD-BANNER": {
    serviceCode: "GD-BANNER",
    displayName: "Banner",
    medium: "both",
    printVariants: {
      "rollup_85x200":      makePrintSpec(850, 2000, { bleedMm: 10, safeAreaMm: 50, dpi: 150 }),
      "rollup_100x200":     makePrintSpec(1000, 2000, { bleedMm: 10, safeAreaMm: 50, dpi: 150 }),
      "xbanner_60x160":     makePrintSpec(600, 1600, { bleedMm: 10, safeAreaMm: 40, dpi: 150 }),
      "backdrop_3x2":       makePrintSpec(3000, 2000, { bleedMm: 10, safeAreaMm: 80, dpi: 72 }),
      "backdrop_6x3":       makePrintSpec(6000, 3000, { bleedMm: 10, safeAreaMm: 100, dpi: 72 }),
      "fascia_3x1":         makePrintSpec(3000, 1000, { bleedMm: 10, safeAreaMm: 50, dpi: 72 }),
    },
    digitalVariants: {
      "leaderboard_728x90":     makeDigitalSpec(728, 90, { dpi: 72, safeAreaPx: 5 }),
      "medium_rectangle_300x250": makeDigitalSpec(300, 250, { dpi: 72, safeAreaPx: 10 }),
      "half_page_300x600":      makeDigitalSpec(300, 600, { dpi: 72, safeAreaPx: 10 }),
      "billboard_970x250":      makeDigitalSpec(970, 250, { dpi: 72, safeAreaPx: 10 }),
      "fb_cover_1920x630":      makeDigitalSpec(1920, 630, { dpi: 72, safeAreaPx: 40 }),
      "yt_channel_2560x1440":   makeDigitalSpec(2560, 1440, { dpi: 96, safeAreaPx: 80 }),
    },
    defaultVariant:    "rollup_85x200",
    supportedVariants: ["rollup_85x200", "rollup_100x200", "xbanner_60x160", "backdrop_3x2", "backdrop_6x3", "fascia_3x1", "leaderboard_728x90", "medium_rectangle_300x250", "half_page_300x600", "billboard_970x250", "fb_cover_1920x630", "yt_channel_2560x1440"],
  },

  // ── GD-BROCHURE ─────────────────────────────────────────────────────────────
  "GD-BROCHURE": {
    serviceCode: "GD-BROCHURE",
    displayName: "Brochure",
    medium: "both",
    printVariants: {
      "trifold_a4":    makePrintSpec(210, 297),   // folded A4 trifold (flat: 630×297)
      "bifold_a4":     makePrintSpec(210, 297),
      "gatefold_a4":   makePrintSpec(210, 297),
      "dl_trifold":    makePrintSpec(99, 210),
      "a5_bifold":     makePrintSpec(148, 210),
      "square_210":    makePrintSpec(210, 210),
    },
    digitalVariants: {
      "a4_digital":    makeDigitalSpec(2480, 3508, { dpi: 150, safeAreaPx: 60 }),
      "dl_digital":    makeDigitalSpec(1181, 2480, { dpi: 150, safeAreaPx: 40 }),
    },
    defaultVariant:    "trifold_a4",
    supportedVariants: ["trifold_a4", "bifold_a4", "gatefold_a4", "dl_trifold", "a5_bifold", "square_210", "a4_digital", "dl_digital"],
  },

  // ── GD-SOCIAL ───────────────────────────────────────────────────────────────
  "GD-SOCIAL": {
    serviceCode: "GD-SOCIAL",
    displayName: "Social Media Kit",
    medium: "digital",
    printVariants: {},
    digitalVariants: {
      "ig_post_1080x1080":     makeDigitalSpec(1080, 1080, { dpi: 72, safeAreaPx: 40 }),
      "ig_post_1080x1350":     makeDigitalSpec(1080, 1350, { dpi: 72, safeAreaPx: 40 }),
      "ig_story_1080x1920":    makeDigitalSpec(1080, 1920, { dpi: 72, safeAreaPx: 80 }),
      "ig_carousel_1080x1080": makeDigitalSpec(1080, 1080, { dpi: 72, safeAreaPx: 40 }),
      "fb_post_1200x628":      makeDigitalSpec(1200, 628, { dpi: 72, safeAreaPx: 30 }),
      "fb_story_1080x1920":    makeDigitalSpec(1080, 1920, { dpi: 72, safeAreaPx: 80 }),
      "fb_cover_1920x630":     makeDigitalSpec(1920, 630, { dpi: 72, safeAreaPx: 60 }),
      "twitter_post_1600x900": makeDigitalSpec(1600, 900, { dpi: 72, safeAreaPx: 30 }),
      "twitter_header_1500x500": makeDigitalSpec(1500, 500, { dpi: 72, safeAreaPx: 30 }),
      "linkedin_post_1200x627": makeDigitalSpec(1200, 627, { dpi: 72, safeAreaPx: 30 }),
      "linkedin_cover_1584x396": makeDigitalSpec(1584, 396, { dpi: 72, safeAreaPx: 30 }),
      "yt_thumbnail_1280x720": makeDigitalSpec(1280, 720, { dpi: 72, safeAreaPx: 40 }),
      "yt_channel_2560x1440":  makeDigitalSpec(2560, 1440, { dpi: 96, safeAreaPx: 80 }),
      "tiktok_post_1080x1920": makeDigitalSpec(1080, 1920, { dpi: 72, safeAreaPx: 80 }),
      "highlight_icon_400x400": makeDigitalSpec(400, 400, { dpi: 72, safeAreaPx: 20 }),
    },
    defaultVariant:    "ig_post_1080x1080",
    supportedVariants: [
      "ig_post_1080x1080", "ig_post_1080x1350", "ig_story_1080x1920", "ig_carousel_1080x1080",
      "fb_post_1200x628", "fb_story_1080x1920", "fb_cover_1920x630",
      "twitter_post_1600x900", "twitter_header_1500x500",
      "linkedin_post_1200x627", "linkedin_cover_1584x396",
      "yt_thumbnail_1280x720", "yt_channel_2560x1440",
      "tiktok_post_1080x1920", "highlight_icon_400x400",
    ],
  },

  // ── GD-CERT ─────────────────────────────────────────────────────────────────
  "GD-CERT": {
    serviceCode: "GD-CERT",
    displayName: "Certificate",
    medium: "both",
    printVariants: {
      "a4_landscape":   makePrintSpec(297, 210),
      "a4_portrait":    makePrintSpec(210, 297),
      "a5_landscape":   makePrintSpec(210, 148),
      "a3_landscape":   makePrintSpec(420, 297, { bleedMm: 3, safeAreaMm: 8 }),
      "letter_landscape": makePrintSpec(279.4, 215.9),
    },
    digitalVariants: {
      "a4_landscape_digital": makeDigitalSpec(3508, 2480, { dpi: 150, safeAreaPx: 80 }),
      "a4_portrait_digital":  makeDigitalSpec(2480, 3508, { dpi: 150, safeAreaPx: 80 }),
    },
    defaultVariant:    "a4_landscape",
    supportedVariants: ["a4_landscape", "a4_portrait", "a5_landscape", "a3_landscape", "letter_landscape", "a4_landscape_digital", "a4_portrait_digital"],
  },

  // ── GD-STATIONERY ───────────────────────────────────────────────────────────
  "GD-STATIONERY": {
    serviceCode: "GD-STATIONERY",
    displayName: "Stationery Suite",
    medium: "both",
    printVariants: {
      // Component specs are defined individually per item in componentSpecs below.
      // The blueprint for stationery is per-item, not a single canvas.
      "letterhead_a4":   makePrintSpec(210, 297),
      "envelope_dl":     makePrintSpec(220, 110),
      "business_card":   makePrintSpec(90, 55),
      "notepad_a5":      makePrintSpec(148, 210),
      "notepad_a4":      makePrintSpec(210, 297),
      "folder_a4":       makePrintSpec(450, 310, { bleedMm: 5, safeAreaMm: 8 }),
    },
    digitalVariants: {
      "id_card_85x54":   makeDigitalSpec(1004, 638, { dpi: 300, safeAreaPx: 30 }),
    },
    defaultVariant:    "letterhead_a4",
    supportedVariants: ["letterhead_a4", "envelope_dl", "business_card", "notepad_a5", "notepad_a4", "folder_a4", "id_card_85x54"],
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getBlueprint(serviceCode: GdServiceCode): ServiceBlueprint {
  const bp = BLUEPRINTS[serviceCode];
  if (!bp) throw new Error(`No blueprint found for service code: ${serviceCode}`);
  return bp;
}

export function getVariantSpec(
  serviceCode: GdServiceCode,
  variant: string
): PrintSpec | DigitalSpec {
  const bp = getBlueprint(serviceCode);
  const spec = bp.printVariants[variant] ?? bp.digitalVariants[variant];
  if (!spec) throw new Error(`Variant "${variant}" not found for service ${serviceCode}`);
  return spec;
}

export function isPrintSpec(spec: PrintSpec | DigitalSpec): spec is PrintSpec {
  return "bleedMm" in spec && (spec as PrintSpec).bleedMm > 0;
}

export function getAllBlueprints(): Record<GdServiceCode, ServiceBlueprint> {
  return BLUEPRINTS;
}

/** Returns all variant names for a service, grouped by medium. */
export function getVariantGroups(serviceCode: GdServiceCode): {
  print: string[];
  digital: string[];
} {
  const bp = getBlueprint(serviceCode);
  return {
    print:   Object.keys(bp.printVariants),
    digital: Object.keys(bp.digitalVariants),
  };
}
