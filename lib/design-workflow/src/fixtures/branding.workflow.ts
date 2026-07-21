/**
 * Branding Design Workflow Fixture
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Stages: Brief → Strategy → Creative Direction → Logo/Identity Concepts
 *         → Selected Direction → Brand System → Guidelines → Export
 *
 * Demonstrates:
 * - Optional guidelines stage (optional based on deliverable)
 * - Review gate after logo/identity concepts
 * - Parallel export stage
 */

import type { DesignWorkflowDefinition } from "../types/definition.js";

export const brandingWorkflow: DesignWorkflowDefinition = {
  workflowId: "branding.full_identity",
  version: 1,
  name: "Branding — Full Brand Identity Workflow",
  description:
    "Complete brand identity design from strategy through export. " +
    "Brand guidelines are optional based on the agreed deliverable scope.",
  pluginId: "branding",
  supportedServiceTypes: [
    "branding_design",
    "brand_identity",
    "brand_refresh",
  ],
  requiredCapabilities: [
    "brief_analysis",
    "brand_strategy",
    "creative_direction",
    "logo_concept",
    "direction_refinement",
    "brand_system",
    "brand_guidelines",
    "export_preparation",
  ],
  stages: [
    {
      id: "brief",
      label: "Brief Analysis",
      description: "Parse brand brief, market positioning, and competitor landscape.",
      requiredCapability: "brief_analysis",
      dependencies: [],
      optional: false,
      repeatable: false,
      parallel: false,
    },
    {
      id: "strategy",
      label: "Brand Strategy",
      description:
        "Define brand positioning, personality, voice, and target audience.",
      requiredCapability: "brand_strategy",
      dependencies: ["brief"],
      optional: false,
      repeatable: false,
      parallel: false,
      artifactOutputs: [
        { artifactType: "brand_strategy_pdf", required: true },
      ],
    },
    {
      id: "creative_direction",
      label: "Creative Direction",
      description:
        "Establish visual direction: colour philosophy, typography approach, and style references.",
      requiredCapability: "creative_direction",
      dependencies: ["strategy"],
      optional: false,
      repeatable: false,
      parallel: false,
      artifactOutputs: [
        { artifactType: "creative_direction_deck", required: true },
      ],
    },
    {
      id: "logo_concepts",
      label: "Logo & Identity Concepts",
      description:
        "Generate 3–5 distinct logo and identity concept directions for client review.",
      requiredCapability: "logo_concept",
      dependencies: ["creative_direction"],
      optional: false,
      repeatable: true,
      parallel: false,
      reviewGate: {
        required: true,
        approverRoles: ["creative_director", "client"],
        minimumApprovals: 1,
        timeoutMs: 259_200_000, // 72h
      },
      artifactOutputs: [
        { artifactType: "logo_concept_pdf", required: true },
        { artifactType: "logo_concept_ai", required: false },
      ],
    },
    {
      id: "selected_direction",
      label: "Selected Direction Refinement",
      description: "Refine the client-approved concept direction to final artwork quality.",
      requiredCapability: "direction_refinement",
      dependencies: ["logo_concepts"],
      optional: false,
      repeatable: true,
      parallel: false,
      artifactOutputs: [
        { artifactType: "refined_logo_pdf", required: true },
        { artifactType: "refined_logo_svg", required: true },
      ],
    },
    {
      id: "brand_system",
      label: "Brand System",
      description:
        "Build the complete brand system: colour palette, typography, icon set, imagery style.",
      requiredCapability: "brand_system",
      dependencies: ["selected_direction"],
      optional: false,
      repeatable: false,
      parallel: false,
      artifactOutputs: [
        { artifactType: "brand_system_pdf", required: true },
        { artifactType: "brand_system_figma", required: false },
      ],
    },
    {
      id: "guidelines",
      label: "Brand Guidelines",
      description:
        "Produce the comprehensive brand guidelines document for internal and agency use. " +
        "Optional if the client's deliverable scope excludes a guidelines document.",
      requiredCapability: "brand_guidelines",
      dependencies: ["brand_system"],
      optional: true,
      repeatable: false,
      parallel: true, // can run alongside export
      activationCondition: {
        type: "deliverable",
        deliverables: ["brand_guidelines", "brand_book"],
      },
      artifactOutputs: [
        { artifactType: "brand_guidelines_pdf", required: true },
      ],
    },
    {
      id: "export",
      label: "Export",
      description: "Package all brand assets into an organised ZIP archive for delivery.",
      requiredCapability: "export_preparation",
      dependencies: ["brand_system"],
      optional: false,
      repeatable: false,
      parallel: true, // can run alongside guidelines
      artifactOutputs: [
        { artifactType: "brand_kit_zip", required: true },
      ],
    },
  ],
  completionPolicy: { type: "all_required" },
  fallbackBehavior: {
    onRequiredStageFailure: "pause_for_review",
    onOptionalStageFailure: "continue",
  },
  tags: ["branding", "identity", "logo", "guidelines"],
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};
