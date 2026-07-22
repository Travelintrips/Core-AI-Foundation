/**
 * packaging-design/plugin/material.ts — Team 26
 *
 * Material contribution spec for the Packaging Design Domain Plugin.
 *
 * Declares the material types, substrate categories, coating options,
 * sustainability profiles, and food-safety requirements that this plugin
 * understands and can route to a print vendor or material supplier.
 *
 * PURE module — no DB calls, no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export const SUBSTRATE_IDS = [
  // Paper / Board
  "sbs_board",           // Solid Bleached Sulfate — premium cosmetics/food
  "kraftback_board",     // Kraft-back board — kraft look with printable surface
  "greyboard",           // Grey board — rigid boxes / gift packaging
  "corrugated_e_flute",  // E-flute corrugated — lightweight shipping
  "corrugated_b_flute",  // B-flute corrugated — standard shipping
  "duplex_board",        // Duplex (grey back) — general packaging
  "cast_coated",         // Mirror gloss cast-coated board
  // Flexible / Film
  "bopp_film",           // Biaxially Oriented Polypropylene — flexible pouch
  "pet_film",            // PET film — high clarity flexible
  "pe_film",             // Polyethylene — stand-up pouch inner
  "aluminium_foil",      // Aluminium foil — barrier laminate
  "kraft_paper_flexible",// Kraft paper flexible pouch
  // Labels
  "paper_label",         // Standard paper label
  "pp_label",            // White PP label — waterproof
  "pe_label",            // PE label — squeezable bottle
  "clear_label",         // Clear BOPP — no-label look
  // Other
  "bioplastic_pla",      // PLA bioplastic — compostable
  "recycled_pet",        // rPET — recycled polyester
  "fsC_recycled_board",  // FSC-certified recycled board
] as const;

export type SubstrateId = (typeof SUBSTRATE_IDS)[number];

export const COATING_IDS = [
  "none",
  "matte_laminate",
  "gloss_laminate",
  "soft_touch_laminate",
  "aqueous_matte",
  "aqueous_gloss",
  "uv_spot",
  "uv_full_gloss",
  "emboss",
  "deboss",
  "foil_hot",
  "foil_cold",
  "pearlescent",
] as const;

export type CoatingId = (typeof COATING_IDS)[number];

export interface SubstrateProfile {
  id:              SubstrateId;
  label:           string;
  category:        "board" | "flexible" | "label" | "bioplastic" | "recycled";
  /** Typical weight range (gsm) or thickness (µm) for this substrate. */
  typicalSpec:     string;
  /** Whether food-contact migration testing is required for this substrate. */
  requiresMigrationTest: boolean;
  /** Whether this substrate is compostable per EN 13432 or ASTM D6400. */
  compostable:     boolean;
  /** Whether the substrate carries recycled content. */
  hasRecycledContent: boolean;
  /** Whether food-safe ink is required for direct contact applications. */
  requiresFoodSafeInk: boolean;
  /** Compatible coating options. */
  compatibleCoatings: CoatingId[];
  notes:           string;
}

export interface MaterialSpec {
  substrateId:     SubstrateId;
  weightOrThickness: string;      // e.g. "350 gsm", "0.3 mm", "50 µm"
  coatingId:       CoatingId;
  /** ISO or other standard that governs this material for the target use. */
  applicableStandard?: string;
  supplierNotes?:  string;
}

export interface MaterialContribution {
  /** Material spec record produced at the 'material' workflow step. */
  spec:              MaterialSpec;
  sustainabilityCerts: string[];
  foodSafetyStatus:  "not_applicable" | "compliant" | "requires_testing" | "non_compliant";
  migrationTestRequired: boolean;
  vendorRecommendations: string[];
}

// ── Substrate registry ────────────────────────────────────────────────────────

const SUBSTRATES: SubstrateProfile[] = [
  {
    id: "sbs_board", label: "SBS Board (Solid Bleached Sulfate)",
    category: "board", typicalSpec: "250–400 gsm",
    requiresMigrationTest: true, compostable: false, hasRecycledContent: false,
    requiresFoodSafeInk: true,
    compatibleCoatings: ["matte_laminate", "gloss_laminate", "aqueous_matte", "aqueous_gloss", "uv_spot", "soft_touch_laminate", "foil_hot"],
    notes: "Premium white board for cosmetics, confectionery, and pharmaceutical packaging.",
  },
  {
    id: "kraftback_board", label: "Kraft-Back Board",
    category: "board", typicalSpec: "280–400 gsm",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: true,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["matte_laminate", "aqueous_matte", "none"],
    notes: "Natural kraft outer face with printable white inner surface.",
  },
  {
    id: "greyboard", label: "Grey Board",
    category: "board", typicalSpec: "1.0–3.0 mm",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: true,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["none", "matte_laminate", "gloss_laminate"],
    notes: "Rigid board for premium gift boxes and luxury packaging.",
  },
  {
    id: "corrugated_e_flute", label: "Corrugated E-Flute",
    category: "board", typicalSpec: "~1.5 mm total",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: true,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["none", "aqueous_matte", "aqueous_gloss"],
    notes: "Lightweight corrugated; good for retail-ready packaging.",
  },
  {
    id: "corrugated_b_flute", label: "Corrugated B-Flute",
    category: "board", typicalSpec: "~3.0 mm total",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: true,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["none", "aqueous_matte"],
    notes: "Standard shipping box; high crush resistance.",
  },
  {
    id: "duplex_board", label: "Duplex Board (Grey Back)",
    category: "board", typicalSpec: "250–400 gsm",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: true,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["matte_laminate", "gloss_laminate", "aqueous_matte", "aqueous_gloss"],
    notes: "Cost-effective general packaging board with grey interior.",
  },
  {
    id: "cast_coated", label: "Cast-Coated Board",
    category: "board", typicalSpec: "200–350 gsm",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: false,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["uv_full_gloss", "uv_spot", "foil_hot", "foil_cold"],
    notes: "Mirror gloss surface for premium cosmetics and luxury goods.",
  },
  {
    id: "bopp_film", label: "BOPP Film",
    category: "flexible", typicalSpec: "20–40 µm",
    requiresMigrationTest: true, compostable: false, hasRecycledContent: false,
    requiresFoodSafeInk: true,
    compatibleCoatings: ["none", "matte_laminate", "gloss_laminate"],
    notes: "Common flexible pouch film; excellent clarity and moisture barrier.",
  },
  {
    id: "pet_film", label: "PET Film",
    category: "flexible", typicalSpec: "12–25 µm",
    requiresMigrationTest: true, compostable: false, hasRecycledContent: false,
    requiresFoodSafeInk: true,
    compatibleCoatings: ["none", "matte_laminate"],
    notes: "High-clarity film; used as outer ply in retort and snack packaging.",
  },
  {
    id: "paper_label", label: "Paper Label",
    category: "label", typicalSpec: "70–90 gsm face stock",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: false,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["gloss_laminate", "matte_laminate", "aqueous_gloss", "aqueous_matte"],
    notes: "Standard paper pressure-sensitive label for glass and rigid containers.",
  },
  {
    id: "clear_label", label: "Clear BOPP Label (No-Label Look)",
    category: "label", typicalSpec: "50–70 µm",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: false,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["gloss_laminate", "none"],
    notes: "Transparent PSA label for a premium no-label appearance on bottles.",
  },
  {
    id: "bioplastic_pla", label: "Bioplastic PLA",
    category: "bioplastic", typicalSpec: "20–50 µm",
    requiresMigrationTest: true, compostable: true, hasRecycledContent: false,
    requiresFoodSafeInk: true,
    compatibleCoatings: ["none"],
    notes: "Compostable (EN 13432) — do not laminate with conventional plastics.",
  },
  {
    id: "fsC_recycled_board", label: "FSC-Certified Recycled Board",
    category: "recycled", typicalSpec: "280–400 gsm",
    requiresMigrationTest: false, compostable: false, hasRecycledContent: true,
    requiresFoodSafeInk: false,
    compatibleCoatings: ["aqueous_matte", "aqueous_gloss", "matte_laminate"],
    notes: "FSC CoC certified; suitable for sustainability branding.",
  },
];

const SUBSTRATE_REGISTRY = new Map<SubstrateId, SubstrateProfile>(
  SUBSTRATES.map((s) => [s.id, s]),
);

export function getSubstrate(id: SubstrateId): SubstrateProfile {
  const s = SUBSTRATE_REGISTRY.get(id);
  if (!s) throw new Error(`Unknown substrate: ${id}`);
  return s;
}

export function listSubstrates(): SubstrateProfile[] {
  return [...SUBSTRATES];
}

export function listSubstratesByCategory(
  category: SubstrateProfile["category"],
): SubstrateProfile[] {
  return SUBSTRATES.filter((s) => s.category === category);
}

/**
 * buildMaterialContribution
 *
 * Given a substrate + coating selection, produce a MaterialContribution record
 * with food-safety status, sustainability certs, and vendor recommendations.
 * Pure function — no DB or external calls.
 */
export function buildMaterialContribution(
  spec: MaterialSpec,
  sustainabilityCerts: string[] = [],
): MaterialContribution {
  const substrate = getSubstrate(spec.substrateId);

  let foodSafetyStatus: MaterialContribution["foodSafetyStatus"] = "not_applicable";
  if (substrate.requiresMigrationTest && !spec.supplierNotes?.includes("migration_tested")) {
    foodSafetyStatus = "requires_testing";
  } else if (substrate.requiresMigrationTest) {
    foodSafetyStatus = "compliant";
  }

  const vendorRecommendations: string[] = [];
  if (substrate.requiresFoodSafeInk) {
    vendorRecommendations.push("Use food-safe inks (e.g. UV-curable low-migration or water-based).");
  }
  if (substrate.compostable) {
    vendorRecommendations.push("Do not laminate with conventional plastic films — this voids compostability certification.");
  }
  if (substrate.hasRecycledContent && !sustainabilityCerts.includes("fsc_certified")) {
    vendorRecommendations.push("Consider obtaining FSC Chain of Custody certification for this substrate.");
  }

  return {
    spec,
    sustainabilityCerts,
    foodSafetyStatus,
    migrationTestRequired: substrate.requiresMigrationTest,
    vendorRecommendations,
  };
}
