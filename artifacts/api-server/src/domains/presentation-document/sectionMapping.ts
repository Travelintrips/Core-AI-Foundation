/**
 * sectionMapping.ts — Team 16: Presentation & Document Creative Services
 *
 * Domain-specific section mapping rules. Each service type defines an ordered
 * list of sections with their data-source bindings and skip conditions.
 *
 * Sections are intentionally declarative — the actual rendering is delegated
 * to the generic Document Engine (CreativeDocumentSpec) or Presentation Engine
 * (CreativePresentationSpec). This file governs WHAT appears and WHY, not HOW.
 */

import type { PresentationDocumentServiceType } from "./types.js";

// ── Section descriptor ────────────────────────────────────────────────────────

export interface SectionDescriptor {
  /** Machine identifier for the section — used in generation reports. */
  id: string;
  /** Human-readable heading used in the rendered document. */
  heading: string;
  /**
   * Priority: "required" sections always appear (even if sparse);
   * "preferred" sections appear when data is available;
   * "optional" sections only appear when the relevant field is non-empty.
   */
  priority: "required" | "preferred" | "optional";
  /** Primary data source field path (dot-notation into project.result or brief). */
  dataSource: string;
  /** Whether a missing dataSource causes the section to be skipped (anti-fabrication). */
  skipIfMissing: boolean;
}

// ── Section maps per service ───────────────────────────────────────────────────

const PROPOSAL_SECTIONS: SectionDescriptor[] = [
  { id: "cover",            heading: "Cover",                     priority: "required",  dataSource: "brandName",             skipIfMissing: false },
  { id: "executive-summary",heading: "Executive Summary",         priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "understanding",    heading: "Understanding Your Needs",  priority: "preferred", dataSource: "briefJson.challenge",   skipIfMissing: true  },
  { id: "scope",            heading: "Scope of Work",             priority: "required",  dataSource: "productOrService",      skipIfMissing: false },
  { id: "approach",         heading: "Our Approach & Methodology",priority: "preferred", dataSource: "copy.methodology",      skipIfMissing: true  },
  { id: "deliverables",     heading: "Deliverables",              priority: "required",  dataSource: "productOrService",      skipIfMissing: false },
  { id: "timeline",         heading: "Proposed Timeline",         priority: "preferred", dataSource: "briefJson.timeline",    skipIfMissing: true  },
  { id: "investment",       heading: "Investment Overview",       priority: "optional",  dataSource: "briefJson.budget_note", skipIfMissing: true  },
  { id: "why-us",           heading: "Why Choose Us",             priority: "preferred", dataSource: "brandStrategy.competitive_advantage", skipIfMissing: true },
  { id: "next-steps",       heading: "Next Steps",                priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "closing",          heading: "Closing",                   priority: "required",  dataSource: "brandName",             skipIfMissing: false },
];

const PRODUCT_CATALOG_SECTIONS: SectionDescriptor[] = [
  { id: "cover",            heading: "Cover",                     priority: "required",  dataSource: "brandName",             skipIfMissing: false },
  { id: "brand-intro",      heading: "About Us",                  priority: "required",  dataSource: "businessType",          skipIfMissing: false },
  { id: "categories",       heading: "Product Categories",        priority: "required",  dataSource: "productOrService",      skipIfMissing: false },
  { id: "products",         heading: "Our Products & Services",   priority: "required",  dataSource: "copy.body_copy",        skipIfMissing: false },
  { id: "features",         heading: "Key Features & Benefits",   priority: "preferred", dataSource: "brandStrategy.brand_values", skipIfMissing: true },
  { id: "differentiators",  heading: "Why We Stand Out",          priority: "optional",  dataSource: "brandStrategy.competitive_advantage", skipIfMissing: true },
  { id: "ordering",         heading: "How to Order",              priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "contact",          heading: "Contact & Support",         priority: "required",  dataSource: "brandName",             skipIfMissing: false },
];

const ANNUAL_REPORT_SECTIONS: SectionDescriptor[] = [
  { id: "cover",            heading: "Cover",                     priority: "required",  dataSource: "brandName",             skipIfMissing: false },
  { id: "chairman-letter",  heading: "Letter from Leadership",    priority: "required",  dataSource: "brandStrategy.positioning", skipIfMissing: false },
  { id: "year-in-review",   heading: "Year in Review",            priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "highlights",       heading: "Key Highlights",            priority: "preferred", dataSource: "briefJson.highlights",  skipIfMissing: true  },
  { id: "operations",       heading: "Operations & Initiatives",  priority: "preferred", dataSource: "productOrService",      skipIfMissing: false },
  { id: "people",           heading: "Our People",                priority: "optional",  dataSource: "briefJson.team",        skipIfMissing: true  },
  { id: "sustainability",   heading: "Sustainability & ESG",      priority: "optional",  dataSource: "briefJson.esg",         skipIfMissing: true  },
  { id: "outlook",          heading: "Outlook & Strategy",        priority: "preferred", dataSource: "brandStrategy.competitive_advantage", skipIfMissing: true },
  { id: "closing",          heading: "Closing Note",              priority: "required",  dataSource: "brandName",             skipIfMissing: false },
];

const WHITEPAPER_SECTIONS: SectionDescriptor[] = [
  { id: "cover",            heading: "Cover",                     priority: "required",  dataSource: "brandName",             skipIfMissing: false },
  { id: "abstract",         heading: "Abstract",                  priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "introduction",     heading: "Introduction",              priority: "required",  dataSource: "brandStrategy.positioning", skipIfMissing: false },
  { id: "problem",          heading: "Problem Statement",         priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "analysis",         heading: "Analysis & Context",        priority: "preferred", dataSource: "copy.body_copy",        skipIfMissing: true  },
  { id: "framework",        heading: "Our Framework / Approach",  priority: "preferred", dataSource: "brandStrategy.brand_values", skipIfMissing: true },
  { id: "findings",         heading: "Key Findings",              priority: "required",  dataSource: "brandStrategy.competitive_advantage", skipIfMissing: false },
  { id: "recommendations",  heading: "Recommendations",           priority: "required",  dataSource: "productOrService",      skipIfMissing: false },
  { id: "conclusion",       heading: "Conclusion",                priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "about",            heading: "About the Author",          priority: "required",  dataSource: "brandName",             skipIfMissing: false },
];

const CASE_STUDY_SECTIONS: SectionDescriptor[] = [
  { id: "cover",            heading: "Cover",                     priority: "required",  dataSource: "brandName",             skipIfMissing: false },
  { id: "executive-summary",heading: "Executive Summary",         priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "client-background",heading: "Client Background",         priority: "preferred", dataSource: "targetMarket",          skipIfMissing: false },
  { id: "challenge",        heading: "The Challenge",             priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "solution",         heading: "Our Solution",              priority: "required",  dataSource: "productOrService",      skipIfMissing: false },
  { id: "approach",         heading: "Approach & Implementation", priority: "preferred", dataSource: "copy.body_copy",        skipIfMissing: true  },
  { id: "outcomes",         heading: "Results & Outcomes",        priority: "preferred", dataSource: "brandStrategy.competitive_advantage", skipIfMissing: true },
  { id: "testimonial",      heading: "Client Perspective",        priority: "optional",  dataSource: "briefJson.testimonial", skipIfMissing: true  },
  { id: "conclusion",       heading: "Key Takeaways",             priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "cta",              heading: "Work With Us",              priority: "required",  dataSource: "brandName",             skipIfMissing: false },
];

const EBOOK_SECTIONS: SectionDescriptor[] = [
  { id: "cover",            heading: "Cover",                     priority: "required",  dataSource: "brandName",             skipIfMissing: false },
  { id: "preface",          heading: "Preface",                   priority: "preferred", dataSource: "goal",                  skipIfMissing: false },
  { id: "toc",              heading: "Table of Contents",         priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "chapter-1",        heading: "Chapter 1: The Landscape",  priority: "required",  dataSource: "brandStrategy.positioning", skipIfMissing: false },
  { id: "chapter-2",        heading: "Chapter 2: The Challenge",  priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "chapter-3",        heading: "Chapter 3: The Solution",   priority: "required",  dataSource: "productOrService",      skipIfMissing: false },
  { id: "chapter-4",        heading: "Chapter 4: Getting Started",priority: "preferred", dataSource: "copy.body_copy",        skipIfMissing: true  },
  { id: "chapter-5",        heading: "Chapter 5: Best Practices", priority: "preferred", dataSource: "brandStrategy.brand_values", skipIfMissing: true },
  { id: "conclusion",       heading: "Conclusion & Next Steps",   priority: "required",  dataSource: "goal",                  skipIfMissing: false },
  { id: "about",            heading: "About the Company",         priority: "required",  dataSource: "brandName",             skipIfMissing: false },
];

// ── Public API ────────────────────────────────────────────────────────────────

export const SECTION_MAPS: Partial<Record<PresentationDocumentServiceType, SectionDescriptor[]>> = {
  proposal:        PROPOSAL_SECTIONS,
  product_catalog: PRODUCT_CATALOG_SECTIONS,
  annual_report:   ANNUAL_REPORT_SECTIONS,
  whitepaper:      WHITEPAPER_SECTIONS,
  case_study:      CASE_STUDY_SECTIONS,
  ebook:           EBOOK_SECTIONS,
};

export function getSectionMap(serviceType: PresentationDocumentServiceType): SectionDescriptor[] {
  return SECTION_MAPS[serviceType] ?? [];
}

export function getRequiredSections(serviceType: PresentationDocumentServiceType): SectionDescriptor[] {
  return getSectionMap(serviceType).filter((s) => s.priority === "required");
}
