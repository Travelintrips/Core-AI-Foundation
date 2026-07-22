/**
 * packaging-design/plugin/compliance.ts — Team 26
 *
 * Compliance metadata for the Packaging Design Domain Plugin.
 *
 * Declares compliance profiles, check definitions, and the metadata
 * structure for the packaging_compliance_sheet artifact.
 *
 * PURE module — no DB calls, no side effects.
 */

import type { RegulatoryBodyEnum } from "./brief.js";
import type { z } from "zod";

export type RegulatoryBody = z.infer<typeof RegulatoryBodyEnum>;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ComplianceCheckSeverity = "blocker" | "warning" | "info";

export type ComplianceCheckOutcome = "passed" | "failed" | "not_applicable" | "pending";

export interface ComplianceCheck {
  code:         string;
  name:         string;
  severity:     ComplianceCheckSeverity;
  regulatoryBody: RegulatoryBody | "internal";
  outcome:      ComplianceCheckOutcome;
  detail:       string;
  /** Reference standard or article (e.g. "BPOM Reg. No. HK.03.1.5.12.11.09955"). */
  referenceStandard?: string;
}

export interface ComplianceProfile {
  profileId:   string;
  label:       string;
  description: string;
  /** Packaging types this profile applies to. */
  appliesTo:   string[];
  checks:      Array<{
    code:            string;
    name:            string;
    severity:        ComplianceCheckSeverity;
    regulatoryBody:  RegulatoryBody | "internal";
    description:     string;
    referenceStandard?: string;
  }>;
}

export interface ComplianceSheetMetadata {
  profileId:      string;
  packagingType:  string;
  brandName:      string;
  productName:    string;
  checks:         ComplianceCheck[];
  outcome:        "passed" | "failed" | "passed_with_warnings";
  blockerCount:   number;
  warningCount:   number;
  regulatoryBodies: string[];
  reviewedBy:     string;
  reviewedAt:     string;
  notes?:         string;
  /** Version of the compliance plugin that generated this sheet. */
  pluginVersion:  string;
}

// ── Compliance profiles ───────────────────────────────────────────────────────

export const COMPLIANCE_PROFILES: ComplianceProfile[] = [
  {
    profileId:   "indonesia_food",
    label:       "Indonesia Food Packaging Compliance",
    description: "BPOM, SNI, and Halal MUI requirements for food packaging sold in Indonesia.",
    appliesTo:   ["food_packaging", "bottle_label", "jar_label", "cup"],
    checks: [
      {
        code: "bpom_registration",
        name: "BPOM Registration Number",
        severity: "blocker",
        regulatoryBody: "bpom",
        description: "Food packaging must bear a valid BPOM MD/ML/PIRT registration number.",
        referenceStandard: "BPOM Regulation HK.03.1.23.04.12.2205 Tahun 2012",
      },
      {
        code: "halal_label",
        name: "Halal Certification Label",
        severity: "warning",
        regulatoryBody: "halal_mui",
        description:
          "Products distributed to Muslim-majority markets should carry MUI halal certification.",
        referenceStandard: "UU No. 33 Tahun 2014 tentang Jaminan Produk Halal",
      },
      {
        code: "ingredients_list",
        name: "Ingredients List",
        severity: "blocker",
        regulatoryBody: "bpom",
        description:
          "All ingredients must be listed in descending order of weight, in Indonesian.",
        referenceStandard: "BPOM Regulation No. 31 Tahun 2018 tentang Label Pangan Olahan",
      },
      {
        code: "nutrition_facts",
        name: "Nutrition Facts Table",
        severity: "warning",
        regulatoryBody: "bpom",
        description:
          "Nutrition information is required for processed food products unless exempt by BPOM.",
        referenceStandard: "BPOM Regulation No. 22 Tahun 2019",
      },
      {
        code: "net_weight_declaration",
        name: "Net Weight / Volume Declaration",
        severity: "blocker",
        regulatoryBody: "sni",
        description:
          "Net weight or volume must be declared prominently on the principal display panel.",
        referenceStandard: "SNI 30-0065-1996",
      },
      {
        code: "allergen_warning",
        name: "Allergen Warning",
        severity: "warning",
        regulatoryBody: "bpom",
        description:
          "Products containing common allergens (gluten, nuts, dairy, soy, etc.) must display " +
          "a clear allergen warning.",
      },
      {
        code: "food_safe_ink",
        name: "Food-Safe Ink Declaration",
        severity: "blocker",
        regulatoryBody: "internal",
        description:
          "Direct-contact food packaging must use food-safe (low-migration) inks.",
        referenceStandard: "EuPIA Guideline on Printing Inks Applied to the Non-Food Contact Surface",
      },
    ],
  },
  {
    profileId:   "indonesia_cosmetic",
    label:       "Indonesia Cosmetic Packaging Compliance",
    description: "BPOM and SNI requirements for cosmetic product packaging in Indonesia.",
    appliesTo:   ["cosmetic_packaging", "bottle_label", "jar_label"],
    checks: [
      {
        code: "bpom_cosmetic_registration",
        name: "BPOM Cosmetic Notification Number (NA/NA-CE)",
        severity: "blocker",
        regulatoryBody: "bpom",
        description: "Cosmetics must bear the BPOM notification number (NA followed by digits).",
        referenceStandard: "Peraturan BPOM No. 12 Tahun 2020",
      },
      {
        code: "ingredient_inci",
        name: "INCI Ingredient List",
        severity: "blocker",
        regulatoryBody: "bpom",
        description:
          "Ingredients must be listed using INCI nomenclature in descending order of concentration.",
        referenceStandard: "ASEAN Cosmetics Directive Annex II",
      },
      {
        code: "usage_instructions",
        name: "Usage Instructions",
        severity: "warning",
        regulatoryBody: "bpom",
        description: "Products with non-obvious usage must include clear directions for use.",
      },
      {
        code: "expiry_date",
        name: "Expiry / PAO Date",
        severity: "blocker",
        regulatoryBody: "bpom",
        description:
          "Products must state best-before date or Period After Opening (PAO) symbol.",
        referenceStandard: "Peraturan BPOM No. 23 Tahun 2019",
      },
      {
        code: "country_of_origin",
        name: "Country of Origin",
        severity: "warning",
        regulatoryBody: "bpom",
        description: "Country of manufacture must be declared for imported cosmetics.",
      },
    ],
  },
  {
    profileId:   "general_retail",
    label:       "General Retail Packaging",
    description: "Basic internal compliance checks applicable to all retail packaging types.",
    appliesTo:   ["box", "pouch", "sleeve", "cup"],
    checks: [
      {
        code: "brand_name_prominent",
        name: "Brand Name Visibility",
        severity: "warning",
        regulatoryBody: "internal",
        description: "Brand name must be clearly readable on at least one primary panel.",
      },
      {
        code: "barcode_quiet_zone",
        name: "Barcode Quiet Zone",
        severity: "blocker",
        regulatoryBody: "internal",
        description:
          "Barcode quiet zone must be at least 2.5× the narrowest bar width on each side. " +
          "No artwork or text may encroach on the quiet zone.",
        referenceStandard: "GS1 General Specifications Section 5.5",
      },
      {
        code: "recycling_symbol",
        name: "Recycling / Disposal Symbol",
        severity: "info",
        regulatoryBody: "internal",
        description:
          "Adding the appropriate recycling symbol (Möbius loop, plastics resin code) is " +
          "recommended for environmental responsibility.",
      },
      {
        code: "manufactured_by",
        name: "Manufacturer / Distributor Address",
        severity: "warning",
        regulatoryBody: "internal",
        description:
          "Name and address of the manufacturer or distributor should appear on the packaging.",
      },
    ],
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

const PROFILE_REGISTRY = new Map<string, ComplianceProfile>(
  COMPLIANCE_PROFILES.map((p) => [p.profileId, p]),
);

export function getComplianceProfile(profileId: string): ComplianceProfile {
  const p = PROFILE_REGISTRY.get(profileId);
  if (!p) throw new Error(`Unknown compliance profile: ${profileId}`);
  return p;
}

export function listComplianceProfiles(): ComplianceProfile[] {
  return [...COMPLIANCE_PROFILES];
}

/**
 * resolveComplianceProfiles
 *
 * Given a packagingType, return the list of compliance profiles that apply.
 */
export function resolveComplianceProfiles(packagingType: string): ComplianceProfile[] {
  return COMPLIANCE_PROFILES.filter((p) => p.appliesTo.includes(packagingType));
}

/**
 * buildComplianceSheet
 *
 * Generate an initial ComplianceSheetMetadata from a set of resolved profiles
 * and order flags. All checks start as "pending" — the reviewer fills in the
 * outcome during the compliance_review workflow step.
 *
 * PURE — no DB calls.
 */
export function buildComplianceSheet(opts: {
  packagingType:  string;
  brandName:      string;
  productName:    string;
  reviewedBy:     string;
  pluginVersion:  string;
  notes?:         string;
}): ComplianceSheetMetadata {
  const profiles = resolveComplianceProfiles(opts.packagingType);
  if (profiles.length === 0) {
    // Fall back to general_retail if no specific profile matches
    profiles.push(getComplianceProfile("general_retail"));
  }

  const checks: ComplianceCheck[] = profiles.flatMap((profile) =>
    profile.checks.map((c) => ({
      code:             c.code,
      name:             c.name,
      severity:         c.severity,
      regulatoryBody:   c.regulatoryBody,
      outcome:          "pending" as ComplianceCheckOutcome,
      detail:           c.description,
      referenceStandard: c.referenceStandard,
    })),
  );

  // Deduplicate by code (same check appearing in multiple profiles)
  const seen = new Set<string>();
  const dedupedChecks = checks.filter((c) => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });

  const regulatoryBodies = [
    ...new Set(dedupedChecks.map((c) => c.regulatoryBody)),
  ];

  return {
    profileId:       profiles.map((p) => p.profileId).join("+"),
    packagingType:   opts.packagingType,
    brandName:       opts.brandName,
    productName:     opts.productName,
    checks:          dedupedChecks,
    outcome:         "passed",        // recalculate after reviewer fills in outcomes
    blockerCount:    0,
    warningCount:    0,
    regulatoryBodies,
    reviewedBy:      opts.reviewedBy,
    reviewedAt:      new Date().toISOString(),
    notes:           opts.notes,
    pluginVersion:   opts.pluginVersion,
  };
}

/**
 * recalculateOutcome
 *
 * After a reviewer updates check outcomes, call this to recompute the
 * top-level outcome, blockerCount, and warningCount.
 */
export function recalculateOutcome(
  sheet: ComplianceSheetMetadata,
): ComplianceSheetMetadata {
  const blockerCount = sheet.checks.filter(
    (c) => c.outcome === "failed" && c.severity === "blocker",
  ).length;
  const warningCount = sheet.checks.filter(
    (c) => c.outcome === "failed" && c.severity === "warning",
  ).length;

  let outcome: ComplianceSheetMetadata["outcome"];
  if (blockerCount > 0)     outcome = "failed";
  else if (warningCount > 0) outcome = "passed_with_warnings";
  else                       outcome = "passed";

  return { ...sheet, blockerCount, warningCount, outcome };
}
