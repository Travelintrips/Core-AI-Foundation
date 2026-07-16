/**
 * Revision Rules — Issue code → target agent mapping
 *
 * Deterministic routing. The AI's recommendedAgent is advisory;
 * this mapping is authoritative.
 */

import type { RevisionTarget } from "../types/qa.types.js";

// ── Issue code → target agent ─────────────────────────────────────────────────

export const ISSUE_CODE_TO_AGENT: Record<string, RevisionTarget> = {
  // Layout
  LAYOUT_OVERFLOW:          "layout-architect",
  SECTION_OUT_OF_BOUNDS:    "layout-architect",
  SECTION_HIERARCHY:        "layout-architect",
  CONTENT_DENSITY:          "layout-architect",

  // Composition
  VISUAL_IMBALANCE:         "composition-designer",
  FOCAL_POINT_WEAK:         "composition-designer",
  EYE_FLOW_BROKEN:          "composition-designer",
  DENSITY_IMBALANCE:        "composition-designer",

  // Typography
  INVALID_FONT:             "typography-designer",
  TEXT_TOO_SMALL:           "typography-designer",
  LINE_HEIGHT:              "typography-designer",
  TYPOGRAPHY_HIERARCHY:     "typography-designer",
  TEXT_OVERFLOW:            "typography-designer",

  // Color
  LOW_CONTRAST:             "color-designer",
  INVALID_COLOR:            "color-designer",
  COLOR_HARMONY:            "color-designer",
  PALETTE_INCONSISTENT:     "color-designer",

  // Decoration
  DECORATION_OVERLOAD:      "decoration-designer",
  ORNAMENT_DISTRACTING:     "decoration-designer",
  BACKGROUND_TOO_BUSY:      "decoration-designer",

  // Component
  MISSING_COMPONENT:        "component-builder",
  CTA_MISSING:              "component-builder",
  CONTENT_INCOMPLETE:       "component-builder",

  // Variable / binding
  INVALID_VARIABLE:         "variable-designer",
  DUPLICATE_VARIABLE:       "variable-designer",
  UNUSED_REQUIRED_VARIABLE: "variable-designer",

  // Asset
  MISSING_ASSET:            "asset-planner",
  INVALID_ASSET_BINDING:    "asset-planner",
  ASSET_RATIO:              "asset-planner",

  // Engineering / JSON
  INVALID_NODE:             "json-architect",
  INVALID_BINDING:          "json-architect",
  ASSEMBLY_ERROR:           "json-architect",
  UNSUPPORTED_PROPERTY:     "json-architect",

  // Minor / optimizer
  Z_INDEX:                  "optimizer",
  MINOR_OVERLAP:            "optimizer",
  ALIGNMENT:                "optimizer",
  SPACING:                  "optimizer",
  MARGIN:                   "optimizer",
  PADDING:                  "optimizer",
};

/**
 * Priority order for selecting the highest-priority issue when multiple exist.
 * Lower index = higher priority.
 */
export const REVISION_PRIORITY_ORDER: RevisionTarget[] = [
  "json-architect",       // 1. Validation / binding issues
  "component-builder",    // 2. Missing component or binding
  "variable-designer",    // 2b. Variable binding
  "asset-planner",        // 2c. Asset binding
  "layout-architect",     // 3. Layout
  "composition-designer", // 4. Composition
  "typography-designer",  // 5. Typography
  "color-designer",       // 6. Color
  "decoration-designer",  // 7. Decoration
  "optimizer",            // 8. Minor optimizer issues
];

/**
 * Downstream agents that must be re-run when a given agent is revised.
 * Each entry is ordered from first-to-rerun → last.
 */
export const DOWNSTREAM_RERUN: Partial<Record<RevisionTarget, RevisionTarget[]>> = {
  "layout-architect": [
    "composition-designer",
    "typography-designer",
    "color-designer",
    "decoration-designer",
    "component-builder",
  ],
  "composition-designer": [
    "typography-designer",
    "color-designer",
    "decoration-designer",
  ],
  "typography-designer": [
    "component-builder",
  ],
  "color-designer": [
    "decoration-designer",
  ],
  "decoration-designer": [],
  "component-builder": [
    "variable-designer",
    "asset-planner",
  ],
  "variable-designer": [],
  "asset-planner": [],
  "json-architect": [],
  "optimizer": [],
};
