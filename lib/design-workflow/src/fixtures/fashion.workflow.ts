/**
 * Fashion Design Workflow Fixture
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Stages: Brief → Moodboard → Concept Sketch → Technical Drawing
 *         → Material Selection → Visualization → Production Spec → Campaign
 *
 * Demonstrates:
 * - Optional stage (technical_drawing — skipped for campaign-only projects)
 * - Parallel stage (visualization + campaign run concurrently after material)
 * - Review gate (after concept_sketch)
 * - Conditional stage (technical_drawing mandatory for production_ready goal)
 */

import type { DesignWorkflowDefinition } from "../types/definition.js";

export const fashionWorkflow: DesignWorkflowDefinition = {
  workflowId: "fashion.full_production",
  version: 1,
  name: "Fashion — Full Production Workflow",
  description:
    "End-to-end fashion design from brief through campaign. " +
    "Technical drawing is optional for campaign-only projects.",
  pluginId: "fashion",
  supportedServiceTypes: [
    "fashion_design",
    "fashion_production",
    "fashion_campaign",
  ],
  requiredCapabilities: [
    "brief_analysis",
    "moodboard_generation",
    "concept_sketch",
    "technical_drawing",
    "material_selection",
    "3d_visualization",
    "production_spec",
    "campaign_generation",
  ],
  stages: [
    {
      id: "brief",
      label: "Brief Analysis",
      description: "Parse and validate the client brief. Extract goals, deliverables, and constraints.",
      requiredCapability: "brief_analysis",
      dependencies: [],
      optional: false,
      repeatable: false,
      parallel: false,
    },
    {
      id: "moodboard",
      label: "Moodboard",
      description: "Generate a visual moodboard from brief keywords and references.",
      requiredCapability: "moodboard_generation",
      dependencies: ["brief"],
      optional: false,
      repeatable: true,
      parallel: false,
      artifactOutputs: [
        { artifactType: "moodboard_image", required: true },
      ],
    },
    {
      id: "concept_sketch",
      label: "Concept Sketch",
      description: "Produce initial concept sketches for client review.",
      requiredCapability: "concept_sketch",
      dependencies: ["moodboard"],
      optional: false,
      repeatable: true,
      parallel: false,
      reviewGate: {
        required: true,
        approverRoles: ["creative_director", "client"],
        minimumApprovals: 1,
        timeoutMs: 172_800_000, // 48 hours
      },
      artifactOutputs: [
        { artifactType: "concept_sketch_image", required: true },
      ],
    },
    {
      id: "technical_drawing",
      label: "Technical Drawing",
      description:
        "Detailed technical garment drawing. Mandatory for production-ready garments; " +
        "optional for campaign-only projects.",
      requiredCapability: "technical_drawing",
      dependencies: ["concept_sketch"],
      optional: true,
      repeatable: false,
      parallel: false,
      // Only required when project goal includes production_ready
      activationCondition: {
        type: "goal",
        goals: ["production_ready", "print_production"],
      },
      artifactOutputs: [
        { artifactType: "technical_drawing_pdf", required: true },
        { artifactType: "tech_pack_pdf", required: false },
      ],
    },
    {
      id: "material_selection",
      label: "Material & Component Selection",
      description: "Select fabrics, trims, and components based on approved concept.",
      requiredCapability: "material_selection",
      // Depends on concept_sketch; technical_drawing is optional so cannot be a hard dep
      dependencies: ["concept_sketch"],
      optional: false,
      repeatable: false,
      parallel: false,
    },
    {
      id: "visualization",
      label: "3D Visualization",
      description: "Render photorealistic 3D visualizations on the selected materials.",
      requiredCapability: "3d_visualization",
      dependencies: ["material_selection"],
      optional: false,
      repeatable: true,
      parallel: true, // can run alongside campaign
      artifactOutputs: [
        { artifactType: "visualization_render", required: true },
      ],
    },
    {
      id: "production_spec",
      label: "Production Specification",
      description: "Generate BOM, stitching specs, and grading instructions.",
      requiredCapability: "production_spec",
      dependencies: ["material_selection"],
      optional: true,
      repeatable: false,
      parallel: true, // can run alongside visualization
      activationCondition: {
        type: "goal",
        goals: ["production_ready", "print_production"],
      },
      artifactOutputs: [
        { artifactType: "production_spec_pdf", required: true },
      ],
    },
    {
      id: "campaign",
      label: "Campaign Assets",
      description: "Generate marketing campaign images and copy.",
      requiredCapability: "campaign_generation",
      dependencies: ["visualization"],
      optional: true,
      repeatable: false,
      parallel: false,
      activationCondition: {
        type: "deliverable",
        deliverables: ["campaign_assets", "social_media_content"],
      },
      artifactOutputs: [
        { artifactType: "campaign_image", required: true },
        { artifactType: "campaign_copy", required: false },
      ],
    },
  ],
  completionPolicy: { type: "all_required" },
  fallbackBehavior: {
    onRequiredStageFailure: "pause_for_review",
    onOptionalStageFailure: "continue",
  },
  tags: ["fashion", "production", "campaign"],
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};
