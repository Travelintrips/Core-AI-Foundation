/**
 * packaging-design/plugin/workflow.ts — Team 26
 *
 * 12-step Packaging Design workflow definition.
 *
 * Each step declares:
 *   - id           stable snake_case key
 *   - sequence     1-based ordering
 *   - label        human-readable name
 *   - description  what happens in this step
 *   - artifactTypes which artifact types are produced at this step
 *   - requiredInputs fields/artifacts required before the step can start
 *   - transitions  which steps may follow
 *
 * PURE module — no DB calls, no side effects.
 */

import type { PackagingArtifactTypeId } from "./artifacts.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export const WORKFLOW_STEP_IDS = [
  "brief",
  "product_requirements",
  "market_research",
  "visual_direction",
  "structure_direction",
  "dieline_input",
  "artwork",
  "material",
  "mockup",
  "compliance_review",
  "production_spec",
  "export",
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEP_IDS)[number];

export interface WorkflowStep {
  id:              WorkflowStepId;
  sequence:        number;
  label:           string;
  description:     string;
  /** Artifact types produced at this step. */
  artifactTypes:   PackagingArtifactTypeId[];
  /** Step ids that must be completed before this step begins. */
  requiredInputs:  WorkflowStepId[];
  /** Steps that may directly follow this one. */
  transitions:     WorkflowStepId[];
  /**
   * Whether a human review/approval gate occurs at the end of this step.
   * When true, the workflow pauses until the reviewer explicitly approves.
   */
  hasApprovalGate: boolean;
  /** Whether this step may be revisited (loop-back) during revisions. */
  revisitable:     boolean;
}

export interface WorkflowDefinition {
  pluginId:   string;
  version:    string;
  steps:      WorkflowStep[];
  initialStep: WorkflowStepId;
  terminalStep: WorkflowStepId;
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS: WorkflowStep[] = [
  {
    id:              "brief",
    sequence:        1,
    label:           "Brief",
    description:
      "Customer submits a complete brief covering product type, packaging type, dimensions, " +
      "quantity, target market, brand, regulatory requirements, printing method, material, " +
      "sustainability, logistics constraints, and barcode/label requirements.",
    artifactTypes:   [],
    requiredInputs:  [],
    transitions:     ["product_requirements"],
    hasApprovalGate: false,
    revisitable:     true,
  },
  {
    id:              "product_requirements",
    sequence:        2,
    label:           "Product Requirements",
    description:
      "Designer documents structural requirements: weight bearing, drop resistance, tamper " +
      "evidence, food-safety ink, child-resistant closure, and any mandatory zone allocations " +
      "derived from the brief.",
    artifactTypes:   [],
    requiredInputs:  ["brief"],
    transitions:     ["market_research"],
    hasApprovalGate: false,
    revisitable:     true,
  },
  {
    id:              "market_research",
    sequence:        3,
    label:           "Market / Reference Research",
    description:
      "Team collects competitive packaging references, trend boards, and materials that " +
      "align with the target market and distribution region. A moodboard is produced as the " +
      "primary deliverable.",
    artifactTypes:   ["packaging_moodboard"],
    requiredInputs:  ["product_requirements"],
    transitions:     ["visual_direction"],
    hasApprovalGate: true,
    revisitable:     true,
  },
  {
    id:              "visual_direction",
    sequence:        4,
    label:           "Visual Direction",
    description:
      "2–3 visual direction concepts are presented based on the approved moodboard: color " +
      "palette, typography, graphic style, and layout system. Client selects or merges a direction.",
    artifactTypes:   ["packaging_moodboard"],
    requiredInputs:  ["market_research"],
    transitions:     ["structure_direction"],
    hasApprovalGate: true,
    revisitable:     true,
  },
  {
    id:              "structure_direction",
    sequence:        5,
    label:           "Structure Direction",
    description:
      "Structural packaging concept is defined: box style (RSC, STE, tuck-end), closure type, " +
      "handle cut-out, window, panels, and dieline zone boundaries. No CAD engine — output is " +
      "a renderer-boundary metadata record.",
    artifactTypes:   ["packaging_structure_concept"],
    requiredInputs:  ["visual_direction"],
    transitions:     ["dieline_input"],
    hasApprovalGate: true,
    revisitable:     true,
  },
  {
    id:              "dieline_input",
    sequence:        6,
    label:           "Dieline Input / Preview",
    description:
      "Dieline template is selected or uploaded. Overlay zones (bleed, trim, safe area, fold, " +
      "cut, glue zone, barcode zone) are declared as renderer boundary metadata. " +
      "No physical dieline is drawn here — the renderer uses these boundaries.",
    artifactTypes:   ["packaging_dieline"],
    requiredInputs:  ["structure_direction"],
    transitions:     ["artwork"],
    hasApprovalGate: false,
    revisitable:     true,
  },
  {
    id:              "artwork",
    sequence:        7,
    label:           "Artwork",
    description:
      "Final artwork files are produced: front, back, side, top, and bottom panels " +
      "respecting overlay zone boundaries. Color mode, bleed, and safe area are applied. " +
      "Barcode zones are reserved but not filled.",
    artifactTypes:   ["packaging_artwork"],
    requiredInputs:  ["dieline_input"],
    transitions:     ["material"],
    hasApprovalGate: true,
    revisitable:     true,
  },
  {
    id:              "material",
    sequence:        8,
    label:           "Material",
    description:
      "Material specification is finalised: substrate, weight, coating, food-safety compliance, " +
      "sustainability certification, and supplier recommendation. Output is the material spec " +
      "artifact.",
    artifactTypes:   ["packaging_material_spec"],
    requiredInputs:  ["artwork"],
    transitions:     ["mockup"],
    hasApprovalGate: false,
    revisitable:     true,
  },
  {
    id:              "mockup",
    sequence:        9,
    label:           "Mockup",
    description:
      "3D or photorealistic mockup renders are produced showing the artwork applied to the " +
      "structural form. Used for client sign-off and marketing before production.",
    artifactTypes:   ["packaging_mockup"],
    requiredInputs:  ["artwork", "material"],
    transitions:     ["compliance_review"],
    hasApprovalGate: true,
    revisitable:     true,
  },
  {
    id:              "compliance_review",
    sequence:        10,
    label:           "Compliance Review",
    description:
      "All mandatory regulatory zones (BPOM, SNI, Halal, ingredients block, legal block, " +
      "nutrition facts) are verified against the brief and applicable standards. " +
      "A compliance sheet is produced documenting passed/failed checks.",
    artifactTypes:   ["packaging_compliance_sheet"],
    requiredInputs:  ["mockup"],
    transitions:     ["production_spec"],
    hasApprovalGate: true,
    revisitable:     false,
  },
  {
    id:              "production_spec",
    sequence:        11,
    label:           "Production Specification",
    description:
      "Full production metadata is assembled: dimensions, dieline reference, material spec, " +
      "color profile, print run quantity, finish, barcode data, and compliance certificate " +
      "references. Output is the production spec artifact sent to the print vendor.",
    artifactTypes:   ["packaging_production_spec"],
    requiredInputs:  ["compliance_review"],
    transitions:     ["export"],
    hasApprovalGate: false,
    revisitable:     false,
  },
  {
    id:              "export",
    sequence:        12,
    label:           "Export",
    description:
      "All deliverables are packaged according to the selected export preset (print-ready PDF, " +
      "dieline PDF, artwork source, mockup PNG, production spec PDF) and delivered to the " +
      "client.",
    artifactTypes:   [],
    requiredInputs:  ["production_spec"],
    transitions:     [],
    hasApprovalGate: false,
    revisitable:     false,
  },
];

// ── Transition guard ──────────────────────────────────────────────────────────

/** Build adjacency map for O(1) lookup. */
const TRANSITION_MAP: Map<WorkflowStepId, Set<WorkflowStepId>> = new Map(
  STEPS.map((s) => [s.id, new Set(s.transitions)]),
);

export function isStepTransitionAllowed(
  from: WorkflowStepId,
  to: WorkflowStepId,
): boolean {
  return TRANSITION_MAP.get(from)?.has(to) ?? false;
}

export function getStep(id: WorkflowStepId): WorkflowStep {
  const step = STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`Unknown workflow step: ${id}`);
  return step;
}

export function getNextSteps(id: WorkflowStepId): WorkflowStep[] {
  return getStep(id).transitions.map(getStep);
}

// ── Workflow definition ───────────────────────────────────────────────────────

export const PACKAGING_WORKFLOW: WorkflowDefinition = {
  pluginId:     "packaging-design",
  version:      "1.0.0",
  steps:        STEPS,
  initialStep:  "brief",
  terminalStep: "export",
};
