/**
 * packagingDesignBatchDefinition.ts — Phase 5 Creative Asset Batch Engine
 *
 * Packaging Design (catalog: packaging-design) — the catalog currently
 * promises a single visual concept, NOT a multi-view production dieline.
 * This definition only generates the views entitlement/catalog actually
 * promises; multi-view support activates automatically if a future package
 * or custom quotation grants additional views via limits_json / snapshot —
 * no code change needed, only entitlement data.
 */

import type { GeneratedImageBatchItem, ImageBatchDefinition, ImageBatchItemSpec } from "../imageBatchTypes.js";

const VIEW_DIRECTIONS: Record<string, string> = {
  front: "product packaging design, front-facing view, clean studio mockup on plain background",
  side: "product packaging design, side profile view, clean studio mockup on plain background",
  top: "product packaging design, top-down view, clean studio mockup on plain background",
  "3-4-angle": "product packaging design, 3/4 angle perspective view, clean studio mockup on plain background",
};

export const packagingDesignBatchDefinition: ImageBatchDefinition = {
  batchType: "packaging_design",
  serviceCodes: ["packaging-design"],
  catalogFallback: {
    // Catalog only promises "Visual concept kemasan" — one concept, one view.
    // Do NOT force 4 views here; that would overclaim what was sold.
    batchType: "packaging_design",
    zipRequired: true,
    totalItems: 1,
    groups: [{ key: "front", label: "Front View Concept", count: 1, aspectRatio: "4:5" }],
  },

  buildItems(entitlement, brief): ImageBatchItemSpec[] {
    return entitlement.groups.map((group) => {
      const direction = VIEW_DIRECTIONS[group.key] ?? `product packaging design, ${group.label.toLowerCase()}`;
      return {
        itemKey: group.key,
        group: group.key,
        groupLabel: group.label,
        role: {
          role: `packaging_${group.key}`,
          label: group.label,
          promptHint: direction,
          aspectRatio: group.aspectRatio ?? "4:5",
          noText: true, // packaging surface stays clean; brand name is baked in via overlay
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
    return `packaging-design/${item.group}`;
  },
};
