/**
 * Interior Design Workflow Fixture
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Stages: Brief → Site/Space Data → Moodboard → Space Plan
 *         → Material Board → Elevation → Visualization → Specification/BOQ → Presentation
 *
 * Demonstrates:
 * - Optional BOQ stage (skipped for concept-only projects)
 * - Parallel stages (elevation + material board)
 * - Review gate after space plan
 */

import type { DesignWorkflowDefinition } from "../types/definition.js";

export const interiorWorkflow: DesignWorkflowDefinition = {
  workflowId: "interior.full_design",
  version: 1,
  name: "Interior Design — Full Design Workflow",
  description:
    "Full interior design pipeline from brief to presentation. " +
    "BOQ is optional when the customer requests concept visualization only.",
  pluginId: "interior",
  supportedServiceTypes: [
    "interior_design",
    "interior_concept",
    "interior_renovation",
  ],
  requiredCapabilities: [
    "brief_analysis",
    "site_data_collection",
    "moodboard_generation",
    "space_planning",
    "material_board",
    "elevation_drawing",
    "3d_visualization",
    "boq_generation",
    "presentation_builder",
  ],
  stages: [
    {
      id: "brief",
      label: "Brief Analysis",
      description: "Parse client brief, site constraints, and style preferences.",
      requiredCapability: "brief_analysis",
      dependencies: [],
      optional: false,
      repeatable: false,
      parallel: false,
    },
    {
      id: "site_data",
      label: "Site & Space Data",
      description: "Collect floor plan dimensions, photos, and site survey data.",
      requiredCapability: "site_data_collection",
      dependencies: ["brief"],
      optional: false,
      repeatable: false,
      parallel: false,
      artifactOutputs: [
        { artifactType: "floor_plan", required: true },
        { artifactType: "site_photos", required: false },
      ],
    },
    {
      id: "moodboard",
      label: "Moodboard",
      description: "Generate a visual moodboard capturing the interior style direction.",
      requiredCapability: "moodboard_generation",
      dependencies: ["brief"],
      optional: false,
      repeatable: true,
      parallel: true, // runs alongside site_data
      artifactOutputs: [
        { artifactType: "moodboard_image", required: true },
      ],
    },
    {
      id: "space_plan",
      label: "Space Plan",
      description: "Create the furniture layout and zoning plan.",
      requiredCapability: "space_planning",
      dependencies: ["site_data", "moodboard"],
      optional: false,
      repeatable: true,
      parallel: false,
      reviewGate: {
        required: true,
        approverRoles: ["lead_designer", "client"],
        minimumApprovals: 1,
        timeoutMs: 259_200_000, // 72 hours
      },
      artifactOutputs: [
        { artifactType: "space_plan_pdf", required: true },
      ],
    },
    {
      id: "material_board",
      label: "Material Board",
      description: "Curate material and finish selections for all surfaces.",
      requiredCapability: "material_board",
      dependencies: ["space_plan"],
      optional: false,
      repeatable: false,
      parallel: true, // can run alongside elevation
      artifactOutputs: [
        { artifactType: "material_board_pdf", required: true },
      ],
    },
    {
      id: "elevation",
      label: "Elevation Drawings",
      description: "Produce detailed wall elevation drawings for key rooms.",
      requiredCapability: "elevation_drawing",
      dependencies: ["space_plan"],
      optional: false,
      repeatable: false,
      parallel: true, // can run alongside material_board
      artifactOutputs: [
        { artifactType: "elevation_pdf", required: true },
      ],
    },
    {
      id: "visualization",
      label: "3D Visualization",
      description: "Render photorealistic 3D views of the designed space.",
      requiredCapability: "3d_visualization",
      dependencies: ["material_board", "elevation"],
      optional: false,
      repeatable: true,
      parallel: false,
      artifactOutputs: [
        { artifactType: "visualization_render", required: true },
      ],
    },
    {
      id: "boq",
      label: "Specification & BOQ",
      description:
        "Generate Bill of Quantities and material specification sheet. " +
        "Optional when client requests concept visualization only.",
      requiredCapability: "boq_generation",
      dependencies: ["material_board"],
      optional: true,
      repeatable: false,
      parallel: true, // can run alongside visualization
      activationCondition: {
        type: "not",
        condition: {
          type: "goal",
          goals: ["concept_only"],
        },
      },
      artifactOutputs: [
        { artifactType: "boq_pdf", required: true },
        { artifactType: "spec_sheet_pdf", required: true },
      ],
    },
    {
      id: "presentation",
      label: "Client Presentation",
      description: "Assemble all deliverables into a client-ready presentation deck.",
      requiredCapability: "presentation_builder",
      dependencies: ["visualization"],
      optional: false,
      repeatable: false,
      parallel: false,
      artifactOutputs: [
        { artifactType: "presentation_pptx", required: true },
        { artifactType: "presentation_pdf", required: false },
      ],
    },
  ],
  completionPolicy: { type: "all_required" },
  fallbackBehavior: {
    onRequiredStageFailure: "pause_for_review",
    onOptionalStageFailure: "continue",
  },
  tags: ["interior", "design", "visualization", "presentation"],
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};
