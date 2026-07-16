/**
 * componentMapping.ts — Graphic Design Domain (Team 15)
 *
 * Defines the required component checklist for each Graphic Design service.
 * Components represent design elements that MUST be resolved before a job
 * can be dispatched. Sources indicate where each component comes from.
 *
 * Used by graphicDesignService.ts to validate job readiness beyond brief completeness.
 */

import type { GraphicDesignServiceCode, GdRequiredComponent } from "./types.js";

// ── Component registry ────────────────────────────────────────────────────────

export const GD_REQUIRED_COMPONENTS: Record<GraphicDesignServiceCode, GdRequiredComponent[]> = {
  "logo": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary and optional secondary/accent hex codes" },
    { name: "brand-style",        required: true,  source: "brief",         description: "Visual style directive (modern, classic, minimalist, etc.)" },
    { name: "company-name",       required: true,  source: "brief",         description: "Legal or trading name to render in the logo" },
    { name: "symbol-concept",     required: false, source: "brief",         description: "Concept or metaphor for the logo icon/symbol" },
    { name: "font-pairing",       required: false, source: "brand-dna",     description: "Typography pairing from brand DNA service (Team 7)" },
    { name: "variant-sizes",      required: true,  source: "generated",     description: "Primary, horizontal, icon, white, black outputs" },
  ],
  "business-card": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary and secondary hex codes" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Existing logo file from asset library (Team 8)" },
    { name: "contact-details",    required: true,  source: "brief",         description: "Name, title, email, phone for front face" },
    { name: "font-pairing",       required: true,  source: "brand-dna",     description: "Typography from brand DNA (Team 7)" },
    { name: "front-layout",       required: true,  source: "generated",     description: "Front-face layout composition" },
    { name: "back-content",       required: false, source: "brief",         description: "Back-face content (tagline, QR, etc.)" },
    { name: "print-ready-pdf",    required: true,  source: "generated",     description: "PDF with bleed, crop marks, CMYK" },
  ],
  "letterhead": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary colour for header/footer rules" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Logo for header placement" },
    { name: "contact-block",      required: true,  source: "brief",         description: "Address, phone, email, website" },
    { name: "font-pairing",       required: true,  source: "brand-dna",     description: "Body and heading fonts" },
    { name: "header-layout",      required: true,  source: "generated",     description: "Header zone design (left/center/right)" },
    { name: "footer-layout",      required: true,  source: "generated",     description: "Footer zone with contact and divider" },
    { name: "word-template",      required: true,  source: "generated",     description: "Editable .docx export with style definitions" },
    { name: "print-ready-pdf",    required: true,  source: "generated",     description: "Print-ready A4 PDF with bleed" },
  ],
  "flyer": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary and accent colours" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Brand logo for placement" },
    { name: "headline-copy",      required: true,  source: "brief",         description: "Main headline text" },
    { name: "call-to-action",     required: true,  source: "brief",         description: "CTA text and contact/link" },
    { name: "hero-image",         required: false, source: "generated",     description: "AI-generated hero visual" },
    { name: "body-copy",          required: false, source: "brief",         description: "Supporting body text" },
    { name: "print-ready-pdf",    required: true,  source: "generated",     description: "Print-ready PDF front (and back if double-sided)" },
  ],
  "poster": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary and accent colours for poster" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Brand logo" },
    { name: "headline-copy",      required: true,  source: "brief",         description: "Dominant headline text" },
    { name: "hero-visual",        required: true,  source: "generated",     description: "AI-generated primary visual (photo/illustration/abstract)" },
    { name: "body-copy",          required: false, source: "brief",         description: "Secondary text and call-to-action" },
    { name: "print-ready-pdf",    required: true,  source: "generated",     description: "Print-ready PDF at specified size" },
    { name: "digital-jpg",        required: true,  source: "generated",     description: "High-res JPG for digital distribution" },
  ],
  "banner": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary and accent colours" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Brand logo for banner header" },
    { name: "headline-copy",      required: true,  source: "brief",         description: "Primary banner headline" },
    { name: "banner-dimensions",  required: true,  source: "brief",         description: "Width × height in mm for print vendor" },
    { name: "hero-visual",        required: false, source: "generated",     description: "Optional AI-generated background visual" },
    { name: "print-ready-pdf",    required: true,  source: "generated",     description: "Print-ready PDF with full bleed" },
  ],
  "brochure": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary and accent colours" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Brand logo for cover" },
    { name: "cover-headline",     required: true,  source: "brief",         description: "Cover page headline" },
    { name: "section-content",    required: true,  source: "brief",         description: "Per-panel/section text content" },
    { name: "hero-visuals",       required: false, source: "generated",     description: "AI-generated imagery for panels" },
    { name: "fold-layout",        required: true,  source: "brief",         description: "Trifold/bifold/z-fold layout grid" },
    { name: "print-ready-pdf",    required: true,  source: "generated",     description: "Print-ready flat PDF (spreads + individual panels)" },
    { name: "digital-pdf",        required: true,  source: "generated",     description: "Screen-optimised PDF for email/web" },
  ],
  "social-media": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Primary and accent colours" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Brand logo for watermark/overlay" },
    { name: "platform-list",      required: true,  source: "brief",         description: "Target platforms and required sizes" },
    { name: "content-theme",      required: true,  source: "brief",         description: "Visual and copy theme for the kit" },
    { name: "caption-copy",       required: false, source: "brief",         description: "Post caption and hashtags" },
    { name: "post-visuals",       required: true,  source: "generated",     description: "AI-generated per-platform visuals at spec dimensions" },
    { name: "story-assets",       required: false, source: "generated",     description: "Story-format assets (1080×1920)" },
    { name: "cover-assets",       required: false, source: "generated",     description: "Profile/channel cover images" },
  ],
  "certificate": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Issuing organisation's brand colours" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Issuing organisation logo" },
    { name: "certificate-title",  required: true,  source: "brief",         description: "Certificate heading (e.g. 'Certificate of Achievement')" },
    { name: "body-text",          required: true,  source: "brief",         description: "Body copy including recipient label" },
    { name: "signatory-block",    required: true,  source: "brief",         description: "Signatory name(s) and title(s)" },
    { name: "border-ornaments",   required: false, source: "generated",     description: "AI-generated border/frame elements" },
    { name: "seal-graphic",       required: false, source: "generated",     description: "Optional seal or emblem graphic" },
    { name: "print-ready-pdf",    required: true,  source: "generated",     description: "Print-ready landscape A4 PDF" },
    { name: "blank-template-pdf", required: true,  source: "generated",     description: "Fillable blank PDF for manual issuance" },
  ],
  "stationery": [
    { name: "brand-colors",       required: true,  source: "brief",         description: "Consistent colour palette across all items" },
    { name: "logo-asset",         required: false, source: "asset-library", description: "Brand logo applied to all pieces" },
    { name: "item-list",          required: true,  source: "brief",         description: "Which stationery items to produce" },
    { name: "contact-block",      required: true,  source: "brief",         description: "Address, phone, email, website" },
    { name: "font-pairing",       required: true,  source: "brand-dna",     description: "Typography from brand DNA (Team 7)" },
    { name: "letterhead-layout",  required: true,  source: "generated",     description: "A4 letterhead print-ready PDF" },
    { name: "envelope-layout",    required: false, source: "generated",     description: "DL envelope print-ready PDF" },
    { name: "business-card-set",  required: false, source: "generated",     description: "Business card front/back PDFs" },
    { name: "woc-slip",           required: false, source: "generated",     description: "With-compliments slip PDF" },
  ],
};

/**
 * Get the component checklist for a service.
 * Returns all components (required and optional) sorted: required first.
 */
export function getGdComponents(serviceCode: GraphicDesignServiceCode): GdRequiredComponent[] {
  const components = GD_REQUIRED_COMPONENTS[serviceCode] ?? [];
  return [...components].sort((a, b) =>
    a.required === b.required ? 0 : a.required ? -1 : 1,
  );
}

/**
 * Validate that required components from non-brief sources are resolvable.
 * Returns a list of component names that cannot be resolved.
 */
export function checkComponentReadiness(
  serviceCode: GraphicDesignServiceCode,
  context: {
    hasLogoAsset: boolean;
    hasBrandDna: boolean;
    hasAssetLibrary: boolean;
  },
): string[] {
  const components = GD_REQUIRED_COMPONENTS[serviceCode] ?? [];
  const unresolvable: string[] = [];

  for (const comp of components) {
    if (!comp.required) continue;
    if (comp.source === "brief") continue;      // brief completeness checked separately
    if (comp.source === "generated") continue;  // generated during job execution

    if (comp.source === "brand-dna" && !context.hasBrandDna) {
      unresolvable.push(comp.name);
    }
    if (comp.source === "asset-library" && !context.hasAssetLibrary) {
      unresolvable.push(comp.name);
    }
  }

  return unresolvable;
}
