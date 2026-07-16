/**
 * types.ts — Team 16: Presentation & Document Creative Services
 *
 * Domain-specific types for the Presentation and Document domain.
 * These types sit on TOP of the generic Document/Presentation engines —
 * never replacing them — and carry Team 16-specific metadata.
 */

// ── Service identifiers owned by this domain ──────────────────────────────────

export type PresentationDocumentServiceType =
  | "company_profile"         // existing — do not rewrite
  | "pitch_deck"              // existing — do not rewrite
  | "proposal"
  | "product_catalog"
  | "annual_report"
  | "whitepaper"
  | "case_study"
  | "ebook";

// ── Delivery format per service ────────────────────────────────────────────────

export type DeliveryFormat = "pdf" | "pptx" | "pdf_and_pptx";

export interface ServiceFormatSpec {
  serviceType:    PresentationDocumentServiceType;
  primaryFormat:  DeliveryFormat;
  /** Whether a PDF preview is always generated alongside a PPTX. */
  alwaysPdfPreview: boolean;
}

export const SERVICE_FORMAT_MAP: Record<PresentationDocumentServiceType, ServiceFormatSpec> = {
  company_profile: { serviceType: "company_profile", primaryFormat: "pdf",       alwaysPdfPreview: false },
  pitch_deck:      { serviceType: "pitch_deck",      primaryFormat: "pptx",      alwaysPdfPreview: true  },
  proposal:        { serviceType: "proposal",        primaryFormat: "pdf",       alwaysPdfPreview: false },
  product_catalog: { serviceType: "product_catalog", primaryFormat: "pdf",       alwaysPdfPreview: false },
  annual_report:   { serviceType: "annual_report",   primaryFormat: "pdf",       alwaysPdfPreview: false },
  whitepaper:      { serviceType: "whitepaper",      primaryFormat: "pdf",       alwaysPdfPreview: false },
  case_study:      { serviceType: "case_study",      primaryFormat: "pdf",       alwaysPdfPreview: false },
  ebook:           { serviceType: "ebook",           primaryFormat: "pdf",       alwaysPdfPreview: false },
};

// ── Anti-fabrication policy (per-service) ─────────────────────────────────────

export interface AntiFabricationPolicy {
  /**
   * Fields that MUST come from the project brief/outputs — never invented.
   * If absent, the section is skipped rather than padded with placeholders.
   */
  requiredFromBrief:    string[];
  /**
   * Fields that may be derived (combined, formatted) from brief fields.
   */
  derivableFromBrief:   string[];
  /**
   * Sections that are ALWAYS skipped if the underlying data is not in
   * project.result or project.briefJson. Never contain fabricated numbers.
   */
  neverFabricated:      string[];
}

export const ANTI_FABRICATION_POLICIES: Record<PresentationDocumentServiceType, AntiFabricationPolicy> = {
  company_profile: {
    requiredFromBrief:  ["brandName", "businessType"],
    derivableFromBrief: ["about", "vision", "mission"],
    neverFabricated:    ["financials", "revenue", "headcount", "team_roster"],
  },
  pitch_deck: {
    requiredFromBrief:  ["brandName", "businessType", "goal"],
    derivableFromBrief: ["positioning", "tagline"],
    neverFabricated:    ["traction", "revenue", "cap_table", "financial_projections", "team_bios"],
  },
  proposal: {
    requiredFromBrief:  ["brandName", "goal", "productOrService"],
    derivableFromBrief: ["scope", "methodology", "timeline"],
    neverFabricated:    ["pricing_figures", "guarantees", "legal_terms", "payment_schedules"],
  },
  product_catalog: {
    requiredFromBrief:  ["brandName", "productOrService"],
    derivableFromBrief: ["categories", "descriptions", "specifications"],
    neverFabricated:    ["prices", "stock_levels", "availability_dates"],
  },
  annual_report: {
    requiredFromBrief:  ["brandName", "businessType"],
    derivableFromBrief: ["highlights", "initiatives", "outlook"],
    neverFabricated:    ["financials", "revenue", "ebitda", "dividend", "audit_opinion"],
  },
  whitepaper: {
    requiredFromBrief:  ["brandName", "goal"],
    derivableFromBrief: ["abstract", "findings", "recommendations"],
    neverFabricated:    ["statistics", "survey_data", "third_party_citations"],
  },
  case_study: {
    requiredFromBrief:  ["brandName", "productOrService", "goal"],
    derivableFromBrief: ["challenge", "solution", "outcomes"],
    neverFabricated:    ["quantified_results", "roi_figures", "client_names", "testimonials"],
  },
  ebook: {
    requiredFromBrief:  ["brandName", "goal"],
    derivableFromBrief: ["chapters", "key_takeaways"],
    neverFabricated:    ["citations", "research_data", "third_party_statistics"],
  },
};
