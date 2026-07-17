/**
 * product-design — Manufacturer Brief Builder
 *
 * Derives a ManufacturerBrief from a ProductConcept.
 * All output is concept-level direction — not an engineering specification.
 * The builder is PURE: it reads the concept and returns a new brief with no I/O.
 *
 * Integration with disclaimerService guards against unsupported claims
 * in shapeNotes, compatibilityNotes, and any custom logisticsNotes.
 *
 * PURE — no I/O, no side effects.
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { randomUUID } from "crypto";
import type { ProductConcept, FormCategory, MaterialClass } from "../types/concept";
import type {
  ManufacturerBrief,
  ManufacturingProcessHint,
  RequirementEntry,
} from "../types/manufacturer";
import { CONCEPT_DISCLAIMER } from "../types/concept";
import { guardAgainstUnsupportedClaims } from "./disclaimerService";

// ── Process hint inference ─────────────────────────────────────────────────────

const FORM_PROCESS_MAP: Partial<Record<FormCategory, ManufacturingProcessHint[]>> = {
  bottle:    ["blow_molding", "extrusion_blow"],
  tube:      ["extrusion_blow"],
  jar:       ["injection_molding"],
  compact:   ["injection_molding"],
  spray:     ["blow_molding", "injection_molding"],
  dispenser: ["injection_molding"],
  sachet:    ["labeling"],
  pouch:     ["labeling"],
  custom:    ["custom"],
};

const MATERIAL_PROCESS_MAP: Partial<Record<MaterialClass, ManufacturingProcessHint[]>> = {
  glass:           ["glass_molding"],
  aluminum:        ["die_casting"],
  pet_plastic:     ["blow_molding", "injection_molding"],
  hdpe_plastic:    ["blow_molding", "extrusion_blow"],
  pp_plastic:      ["injection_molding"],
  stainless_steel: ["die_casting"],
  paperboard:      ["labeling"],
  bioplastic:      ["blow_molding", "injection_molding"],
};

function inferProcessHints(concept: ProductConcept): ManufacturingProcessHint[] {
  const hints = new Set<ManufacturingProcessHint>();

  const formHints = FORM_PROCESS_MAP[concept.formDirection.category] ?? [];
  formHints.forEach((h) => hints.add(h));

  const matHints = MATERIAL_PROCESS_MAP[concept.materialDirection.primaryMaterial] ?? [];
  matHints.forEach((h) => hints.add(h));

  // Decoration hints based on CMF entries
  if (concept.cmf.entries.length > 0) {
    const hasScreenZone = concept.cmf.entries.some((e) =>
      ["body", "shoulder"].includes(e.zone),
    );
    if (hasScreenZone) hints.add("screen_printing");
  }

  if (concept.labelAreas.length > 0) hints.add("labeling");

  return Array.from(hints);
}

// ── Requirement extraction ─────────────────────────────────────────────────────

function buildRequirements(concept: ProductConcept): RequirementEntry[] {
  const reqs: RequirementEntry[] = [];
  const dims = concept.formDirection.dimensions;

  // Dimension requirements
  reqs.push({
    category: "dimension",
    requirement: "Overall height (concept estimate)",
    value: `≈ ${dims.height} mm`,
    priority: "prefer",
  });
  reqs.push({
    category: "dimension",
    requirement: "Overall width / outer diameter (concept estimate)",
    value: `≈ ${dims.width} mm`,
    priority: "prefer",
  });
  if (dims.depth && dims.depth > 0) {
    reqs.push({
      category: "dimension",
      requirement: "Depth (concept estimate)",
      value: `≈ ${dims.depth} mm`,
      priority: "prefer",
    });
  }
  if (dims.wallThickness) {
    reqs.push({
      category: "dimension",
      requirement: "Wall thickness (indicative)",
      value: `≈ ${dims.wallThickness} mm`,
      priority: "optional",
    });
  }
  if (dims.fillVolumeMl) {
    reqs.push({
      category: "dimension",
      requirement: "Fill volume (indicative)",
      value: `≈ ${dims.fillVolumeMl} mL`,
      priority: "must",
    });
  }

  // Material requirements
  reqs.push({
    category: "material",
    requirement: "Primary material",
    value: concept.materialDirection.primaryMaterial,
    priority: "must",
  });
  if (concept.materialDirection.secondaryMaterial) {
    reqs.push({
      category: "material",
      requirement: "Secondary material (closure / applicator)",
      value: concept.materialDirection.secondaryMaterial,
      priority: "prefer",
    });
  }
  if (concept.materialDirection.compatibilityNotes) {
    reqs.push({
      category: "material",
      requirement: "Compatibility constraints",
      value: concept.materialDirection.compatibilityNotes,
      priority: "must",
    });
  }
  if (concept.materialDirection.sustainabilityNotes) {
    reqs.push({
      category: "material",
      requirement: "Sustainability direction (concept-level aspiration, not certification)",
      value: concept.materialDirection.sustainabilityNotes,
      priority: "optional",
    });
  }

  // Finish requirements from CMF
  const finishes = Array.from(new Set(concept.cmf.entries.map((e) => e.finish)));
  if (finishes.length > 0) {
    reqs.push({
      category: "finish",
      requirement: "Surface finishes required",
      value: finishes.join(", "),
      priority: "must",
    });
  }

  // Label requirements
  for (const la of concept.labelAreas) {
    reqs.push({
      category: "label",
      requirement: `Label area: ${la.name}`,
      value:
        `${la.printAreaMm.width} × ${la.printAreaMm.height} mm, ` +
        `safe margin ${la.safeMarginMm} mm` +
        (la.wrapFraction ? `, wrap ${(la.wrapFraction * 100).toFixed(0)}%` : ""),
      priority: "must",
    });
  }

  // Feature requirements
  for (const fp of concept.featurePlacements) {
    reqs.push({
      category: "feature",
      requirement: `Feature: ${fp.label}`,
      value: `Located at ${fp.anchor}, footprint ≈ ${fp.footprintMm.width} × ${fp.footprintMm.height} mm`,
      priority: "must",
    });
  }

  return reqs;
}

// ── Primary export ─────────────────────────────────────────────────────────────

export interface BuildBriefOptions {
  /** Optional free-text logistics notes. Scanned for unsupported claims. */
  logisticsNotes?: string;
}

/**
 * Builds a ManufacturerBrief from a ProductConcept.
 *
 * Guards against unsupported manufacturing claims in concept notes and
 * any caller-supplied logisticsNotes before building.
 *
 * @throws  If unsupported manufacturing claims are detected in concept notes.
 */
export function buildManufacturerBrief(
  concept: ProductConcept,
  options: BuildBriefOptions = {},
): ManufacturerBrief {
  // ── Claim guard ────────────────────────────────────────────────────────

  guardAgainstUnsupportedClaims(
    {
      shapeNotes:          concept.formDirection.shapeNotes,
      ergonomicNotes:      concept.formDirection.ergonomicNotes,
      sustainabilityNotes: concept.materialDirection.sustainabilityNotes,
      compatibilityNotes:  concept.materialDirection.compatibilityNotes,
      processNotes:        concept.cmf.processNotes,
      logisticsNotes:      options.logisticsNotes,
    },
    "manufacturerBriefBuilder",
  );

  // ── Build brief ────────────────────────────────────────────────────────

  return {
    id:           randomUUID(),
    conceptId:    concept.id,
    conceptName:  concept.name,
    processHints: inferProcessHints(concept),
    requirements: buildRequirements(concept),
    logisticsNotes: options.logisticsNotes,
    disclaimer:   CONCEPT_DISCLAIMER,
    generatedAt:  new Date(),
  };
}
