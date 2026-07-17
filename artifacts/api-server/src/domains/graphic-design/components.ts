/**
 * graphic-design/components.ts — Team 15
 *
 * Required component mapping: what design elements each service MUST contain.
 *
 * A "component" is a named, typed slot that the renderer (Team 7-8) populates.
 * Components are either REQUIRED (absence fails QC) or OPTIONAL (absence is
 * a warning only).
 *
 * This map is consumed by:
 *   - qc.ts   — to verify all required components are present
 *   - service.ts — to build the renderer payload
 *   - manifest.ts — to validate deliverables are complete
 */

import type { GdServiceCode } from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ComponentType =
  | "logo"
  | "wordmark"
  | "icon"
  | "headline"
  | "subheadline"
  | "body_text"
  | "contact_block"
  | "date_field"
  | "signature_line"
  | "seal"
  | "qr_code"
  | "divider"
  | "color_block"
  | "pattern"
  | "image_placeholder"
  | "photo"
  | "call_to_action"
  | "social_handle"
  | "address_block"
  | "legal_text"
  | "page_number"
  | "fold_guide"
  | "bleed_guide"
  | "safe_area_guide"
  | "barcode"
  | "table_of_contents"
  | "section_header"
  | "bullet_list"
  | "certificate_body"
  | "serial_number"
  | "watermark";

export interface ComponentRequirement {
  id:          string;         // Unique within the service (snake_case)
  type:        ComponentType;
  label:       string;         // Human-readable name
  required:    boolean;        // false = optional (warning if absent)
  maxInstances: number;        // -1 = unlimited
  /** Which variants this component applies to (undefined = all variants). */
  variants?:   string[];
  /** Minimum font size in pt for text components (QC enforces this). */
  minFontSizePt?: number;
  /** Minimum contrast ratio against background (WCAG 2.1). */
  minContrast?: 3 | 4.5 | 7;
  description?: string;
}

export type ServiceComponentMap = Record<GdServiceCode, ComponentRequirement[]>;

// ── Component Definitions ─────────────────────────────────────────────────────

const COMPONENT_MAP: ServiceComponentMap = {

  "GD-LOGO": [
    { id: "primary_logo",    type: "logo",       label: "Primary Logo",      required: true,  maxInstances: 1, minContrast: 3 },
    { id: "wordmark",        type: "wordmark",   label: "Wordmark",          required: false, maxInstances: 1 },
    { id: "logo_icon",       type: "icon",       label: "Logo Icon / Mark",  required: false, maxInstances: 1, minContrast: 3 },
    { id: "brand_name_text", type: "headline",   label: "Brand Name",        required: true,  maxInstances: 1, minFontSizePt: 24, minContrast: 4.5 },
    { id: "tagline",         type: "subheadline", label: "Tagline",          required: false, maxInstances: 1, minFontSizePt: 10, minContrast: 4.5 },
    { id: "color_block_dark", type: "color_block", label: "Dark Background Test", required: true, maxInstances: 1, description: "Logo must be legible on dark background" },
    { id: "safe_area",       type: "safe_area_guide", label: "Logo Clear Space Guide", required: true, maxInstances: 1 },
  ],

  "GD-BCARD": [
    { id: "logo_front",      type: "logo",         label: "Logo (Front)",          required: true,  maxInstances: 1, minContrast: 3, variants: ["*_front", "standard_landscape", "standard_portrait", "square", "mini_landscape", "euro_landscape", "us_landscape"] },
    { id: "name_text",       type: "headline",     label: "Contact Name",          required: true,  maxInstances: 1, minFontSizePt: 9, minContrast: 4.5 },
    { id: "title_text",      type: "subheadline",  label: "Job Title",             required: false, maxInstances: 1, minFontSizePt: 7, minContrast: 4.5 },
    { id: "company_text",    type: "body_text",    label: "Company Name",          required: true,  maxInstances: 1, minFontSizePt: 7, minContrast: 4.5 },
    { id: "contact_block",   type: "contact_block", label: "Contact Information",  required: true,  maxInstances: 1, minFontSizePt: 6, minContrast: 4.5 },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1, description: "3 mm bleed on all sides" },
    { id: "safe_area",       type: "safe_area_guide", label: "Safe Area Guide",   required: true,  maxInstances: 1 },
    { id: "back_pattern",    type: "pattern",      label: "Back Design / Pattern", required: false, maxInstances: 1, variants: ["*_double"] },
  ],

  "GD-LTRHEAD": [
    { id: "logo",            type: "logo",         label: "Logo",                  required: true,  maxInstances: 1, minContrast: 3 },
    { id: "company_name",    type: "headline",     label: "Company Name",          required: true,  maxInstances: 1, minFontSizePt: 10, minContrast: 4.5 },
    { id: "tagline",         type: "subheadline",  label: "Tagline / Slogan",      required: false, maxInstances: 1, minFontSizePt: 8 },
    { id: "address_block",   type: "address_block", label: "Company Address",      required: true,  maxInstances: 1, minFontSizePt: 7, minContrast: 4.5 },
    { id: "contact_block",   type: "contact_block", label: "Phone / Email",        required: true,  maxInstances: 1, minFontSizePt: 7, minContrast: 4.5 },
    { id: "body_area",       type: "body_text",    label: "Letter Body Area",      required: true,  maxInstances: 1, description: "Clear area reserved for letter content" },
    { id: "footer_divider",  type: "divider",      label: "Footer Divider",        required: false, maxInstances: 1 },
    { id: "legal_text",      type: "legal_text",   label: "Legal Footer Text",     required: false, maxInstances: 1, minFontSizePt: 6 },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1 },
  ],

  "GD-FLYER": [
    { id: "headline",        type: "headline",     label: "Main Headline",         required: true,  maxInstances: 1, minFontSizePt: 18, minContrast: 4.5 },
    { id: "subheadline",     type: "subheadline",  label: "Sub-Headline",          required: false, maxInstances: 1, minFontSizePt: 10, minContrast: 4.5 },
    { id: "body_text",       type: "body_text",    label: "Body Copy",             required: true,  maxInstances: 3, minFontSizePt: 8, minContrast: 4.5 },
    { id: "logo",            type: "logo",         label: "Brand Logo",            required: true,  maxInstances: 1, minContrast: 3 },
    { id: "image",           type: "image_placeholder", label: "Hero Image",       required: false, maxInstances: 1 },
    { id: "cta",             type: "call_to_action", label: "Call to Action",      required: true,  maxInstances: 1, minFontSizePt: 10, minContrast: 4.5 },
    { id: "contact",         type: "contact_block", label: "Contact Information",  required: false, maxInstances: 1, minFontSizePt: 7 },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1 },
    { id: "safe_area",       type: "safe_area_guide", label: "Safe Area Guide",   required: true,  maxInstances: 1 },
  ],

  "GD-POSTER": [
    { id: "headline",        type: "headline",     label: "Poster Headline",       required: true,  maxInstances: 1, minFontSizePt: 36, minContrast: 4.5 },
    { id: "subheadline",     type: "subheadline",  label: "Supporting Text",       required: false, maxInstances: 2, minFontSizePt: 14, minContrast: 4.5 },
    { id: "body_text",       type: "body_text",    label: "Body Copy",             required: false, maxInstances: 3, minFontSizePt: 10, minContrast: 4.5 },
    { id: "logo",            type: "logo",         label: "Brand / Event Logo",    required: true,  maxInstances: 2, minContrast: 3 },
    { id: "hero_image",      type: "image_placeholder", label: "Hero Image / Background", required: false, maxInstances: 1 },
    { id: "cta",             type: "call_to_action", label: "Call to Action",      required: false, maxInstances: 1, minFontSizePt: 14, minContrast: 4.5 },
    { id: "date_field",      type: "date_field",   label: "Event Date / Deadline", required: false, maxInstances: 1, minFontSizePt: 12 },
    { id: "contact",         type: "contact_block", label: "Contact / Venue Info", required: false, maxInstances: 1 },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1 },
    { id: "safe_area",       type: "safe_area_guide", label: "Safe Area Guide",   required: true,  maxInstances: 1 },
  ],

  "GD-BANNER": [
    { id: "headline",        type: "headline",     label: "Banner Headline",       required: true,  maxInstances: 1, minFontSizePt: 24, minContrast: 4.5 },
    { id: "subheadline",     type: "subheadline",  label: "Supporting Text",       required: false, maxInstances: 1, minFontSizePt: 12, minContrast: 4.5 },
    { id: "logo",            type: "logo",         label: "Brand Logo",            required: true,  maxInstances: 1, minContrast: 3 },
    { id: "cta",             type: "call_to_action", label: "Call to Action",      required: false, maxInstances: 1, minFontSizePt: 16, minContrast: 4.5 },
    { id: "image",           type: "image_placeholder", label: "Visual / Photo",  required: false, maxInstances: 1 },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1, description: "5-10 mm bleed for large format" },
    { id: "safe_area",       type: "safe_area_guide", label: "Safe Area Guide",   required: true,  maxInstances: 1, description: "50 mm safe zone for rollup; accounts for stand hardware" },
  ],

  "GD-BROCHURE": [
    { id: "cover_headline",  type: "headline",     label: "Cover Headline",        required: true,  maxInstances: 1, minFontSizePt: 18, minContrast: 4.5 },
    { id: "cover_logo",      type: "logo",         label: "Cover Logo",            required: true,  maxInstances: 1, minContrast: 3 },
    { id: "section_headers", type: "section_header", label: "Section Headers",    required: true,  maxInstances: 12, minFontSizePt: 12, minContrast: 4.5 },
    { id: "body_text",       type: "body_text",    label: "Body Copy",             required: true,  maxInstances: -1, minFontSizePt: 8, minContrast: 4.5 },
    { id: "images",          type: "image_placeholder", label: "Content Images",  required: false, maxInstances: 12 },
    { id: "contact_back",    type: "contact_block", label: "Back-Panel Contacts", required: true,  maxInstances: 1, minFontSizePt: 7, minContrast: 4.5 },
    { id: "fold_guides",     type: "fold_guide",   label: "Fold Guide Lines",     required: true,  maxInstances: 4, description: "Marks where the sheet is folded" },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1 },
    { id: "page_numbers",    type: "page_number",  label: "Page Numbers",         required: false, maxInstances: -1 },
  ],

  "GD-SOCIAL": [
    { id: "headline",        type: "headline",     label: "Post Headline",         required: true,  maxInstances: 1, minFontSizePt: 18, minContrast: 4.5 },
    { id: "body_text",       type: "body_text",    label: "Post Body Copy",        required: false, maxInstances: 1, minFontSizePt: 10, minContrast: 4.5 },
    { id: "logo",            type: "logo",         label: "Brand Logo",            required: true,  maxInstances: 1, minContrast: 3 },
    { id: "social_handle",   type: "social_handle", label: "Social Handle / CTA", required: false, maxInstances: 1, minFontSizePt: 8 },
    { id: "image",           type: "image_placeholder", label: "Visual / Photo",  required: false, maxInstances: 1 },
    { id: "cta",             type: "call_to_action", label: "Call to Action",      required: false, maxInstances: 1, minFontSizePt: 10, minContrast: 4.5 },
    { id: "safe_area",       type: "safe_area_guide", label: "Safe Area Guide",   required: true,  maxInstances: 1, description: "Platform UI may crop edges; safe area avoids overlap" },
  ],

  "GD-CERT": [
    { id: "certificate_body", type: "certificate_body", label: "Certificate Body Text", required: true, maxInstances: 1, minFontSizePt: 12, minContrast: 4.5 },
    { id: "recipient_name",  type: "headline",     label: "Recipient Name Field",  required: true,  maxInstances: 1, minFontSizePt: 24, minContrast: 4.5 },
    { id: "org_logo",        type: "logo",         label: "Issuing Organisation Logo", required: true, maxInstances: 1, minContrast: 3 },
    { id: "date_field",      type: "date_field",   label: "Issue Date",            required: true,  maxInstances: 1, minFontSizePt: 10 },
    { id: "signature_line",  type: "signature_line", label: "Signature Line",     required: true,  maxInstances: 5 },
    { id: "seal",            type: "seal",         label: "Official Seal / Stamp", required: false, maxInstances: 2, minContrast: 3 },
    { id: "serial_number",   type: "serial_number", label: "Serial / Certificate No.", required: false, maxInstances: 1, minFontSizePt: 7 },
    { id: "border",          type: "pattern",      label: "Decorative Border",    required: false, maxInstances: 1 },
    { id: "watermark",       type: "watermark",    label: "Security Watermark",    required: false, maxInstances: 1, description: "Semi-transparent background watermark for anti-fraud" },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1 },
  ],

  "GD-STATIONERY": [
    { id: "logo",            type: "logo",         label: "Brand Logo",            required: true,  maxInstances: 1, minContrast: 3 },
    { id: "company_name",    type: "headline",     label: "Company Name",          required: true,  maxInstances: 1, minFontSizePt: 9, minContrast: 4.5 },
    { id: "contact_block",   type: "contact_block", label: "Contact Information",  required: true,  maxInstances: 1, minFontSizePt: 7, minContrast: 4.5 },
    { id: "color_block",     type: "color_block",  label: "Brand Color Block",    required: false, maxInstances: 3 },
    { id: "pattern",         type: "pattern",      label: "Brand Pattern / Texture", required: false, maxInstances: 1 },
    { id: "bleed_guide",     type: "bleed_guide",  label: "Bleed Guide",          required: true,  maxInstances: 1 },
    { id: "safe_area",       type: "safe_area_guide", label: "Safe Area Guide",   required: true,  maxInstances: 1 },
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getComponentRequirements(serviceCode: GdServiceCode): ComponentRequirement[] {
  const reqs = COMPONENT_MAP[serviceCode];
  if (!reqs) throw new Error(`No component map for service: ${serviceCode}`);
  return reqs;
}

export function getRequiredComponents(serviceCode: GdServiceCode): ComponentRequirement[] {
  return getComponentRequirements(serviceCode).filter((c) => c.required);
}

export function getOptionalComponents(serviceCode: GdServiceCode): ComponentRequirement[] {
  return getComponentRequirements(serviceCode).filter((c) => !c.required);
}
