/**
 * logoDesignBatchDefinition.ts — Phase 5 Creative Asset Batch Engine
 *
 * "3 konsep logo" (catalog: logo-design) — 3 diverse concepts with real
 * creative-direction diversification (different construction archetypes),
 * not just color-swapped variants of the same idea.
 */

import type { GeneratedImageBatchItem, ImageBatchDefinition, ImageBatchItemSpec } from "../imageBatchTypes.js";

// Distinct logo construction archetypes — this is what makes the 3 concepts
// genuinely different rather than palette swaps of one idea.
const CONCEPT_DIRECTIONS: Record<string, string> = {
  "concept-1":
    "wordmark-led minimalist logo, custom lettering of the brand name, no icon, clean geometric typography",
  "concept-2":
    "icon/symbol-led logo mark, abstract geometric symbol representing the brand's industry, symbol paired with small brand name below",
  "concept-3":
    "emblem or badge-style logo, brand name and a simple icon combined inside a rounded or circular badge shape",
};

export const logoDesignBatchDefinition: ImageBatchDefinition = {
  batchType: "logo_design",
  serviceCodes: ["logo-design"],
  catalogFallback: {
    batchType: "logo_design",
    zipRequired: true,
    totalItems: 3,
    groups: [
      { key: "concept-1", label: "Concept 1 — Wordmark", count: 1, aspectRatio: "1:1" },
      { key: "concept-2", label: "Concept 2 — Icon Mark", count: 1, aspectRatio: "1:1" },
      { key: "concept-3", label: "Concept 3 — Emblem", count: 1, aspectRatio: "1:1" },
    ],
  },

  buildItems(entitlement, brief): ImageBatchItemSpec[] {
    return entitlement.groups.map((group, idx) => {
      const direction = CONCEPT_DIRECTIONS[group.key] ?? CONCEPT_DIRECTIONS[`concept-${(idx % 3) + 1}`]!;
      return {
        itemKey: group.key,
        group: group.key,
        groupLabel: group.label,
        role: {
          role: `logo_${group.key}`,
          label: group.label,
          promptHint: `Professional logo design concept: ${direction}`,
          aspectRatio: group.aspectRatio ?? "1:1",
          noText: false,
          overlay: { kind: "brandName" },
        },
      };
    });
  },

  validateBatch(items: GeneratedImageBatchItem[], entitlement) {
    const accepted = new Set(
      items.filter((i) => i.itemStatus === "completed").map((i) => i.group),
    );
    const missingGroups = entitlement.groups.map((g) => g.key).filter((k) => !accepted.has(k));
    return {
      ok: missingGroups.length === 0,
      missingGroups,
      completedCount: accepted.size,
      requiredCount: entitlement.groups.length,
    };
  },

  zipFolderFor(item) {
    return `logo-concepts/${item.group}`;
  },
};
