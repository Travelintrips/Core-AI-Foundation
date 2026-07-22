/**
 * Packaging Design Workflow Fixture
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Stages: Brief → Product Analysis → Structure → Concept
 *         → Dieline → Material Selection → Mockup → Print Specification → Export
 *
 * Demonstrates:
 * - Mandatory dieline for print-ready, optional for campaign mockup
 * - Parallel stages (material selection + dieline)
 * - Repeatable mockup stage
 */

import type { DesignWorkflowDefinition } from "../types/definition.js";

export const packagingWorkflow: DesignWorkflowDefinition = {
  workflowId: "packaging.full_design",
  version: 1,
  name: "Packaging Design — Full Design Workflow",
  description:
    "End-to-end packaging design pipeline. " +
    "Dieline is mandatory for print-ready output; optional for campaign mockup projects.",
  pluginId: "packaging",
  supportedServiceTypes: [
    "packaging_design",
    "packaging_print",
    "packaging_campaign",
  ],
  requiredCapabilities: [
    "brief_analysis",
    "product_analysis",
    "structural_design",
    "concept_generation",
    "dieline_creation",
    "material_selection",
    "3d_mockup",
    "print_specification",
    "export_preparation",
  ],
  stages: [
    {
      id: "brief",
      label: "Brief Analysis",
      description: "Parse product brief, brand guidelines, and compliance requirements.",
      requiredCapability: "brief_analysis",
      dependencies: [],
      optional: false,
      repeatable: false,
      parallel: false,
    },
    {
      id: "product_analysis",
      label: "Product Analysis",
      description: "Analyse product dimensions, fragility, and retail environment constraints.",
      requiredCapability: "product_analysis",
      dependencies: ["brief"],
      optional: false,
      repeatable: false,
      parallel: false,
    },
    {
      id: "structure",
      label: "Structural Design",
      description: "Design the packaging structure (box style, flaps, closures).",
      requiredCapability: "structural_design",
      dependencies: ["product_analysis"],
      optional: false,
      repeatable: false,
      parallel: false,
      artifactOutputs: [
        { artifactType: "structure_diagram", required: true },
      ],
    },
    {
      id: "concept",
      label: "Concept Design",
      description: "Generate visual concept designs for the packaging exterior.",
      requiredCapability: "concept_generation",
      dependencies: ["structure"],
      optional: false,
      repeatable: true,
      parallel: false,
      reviewGate: {
        required: true,
        approverRoles: ["art_director", "client"],
        minimumApprovals: 1,
        timeoutMs: 172_800_000, // 48h
      },
      artifactOutputs: [
        { artifactType: "concept_image", required: true },
      ],
    },
    {
      id: "dieline",
      label: "Dieline",
      description:
        "Create the production-ready dieline file. " +
        "Mandatory for print-ready output; optional for campaign mockup.",
      requiredCapability: "dieline_creation",
      dependencies: ["concept"],
      optional: true,
      repeatable: false,
      parallel: true, // can run alongside material_selection
      activationCondition: {
        type: "or",
        conditions: [
          { type: "deliverable", deliverables: ["print_ready"] },
          { type: "goal", goals: ["print_production"] },
        ],
      },
      artifactOutputs: [
        { artifactType: "dieline_pdf", required: true },
        { artifactType: "dieline_ai", required: false },
      ],
    },
    {
      id: "material_selection",
      label: "Material Selection",
      description: "Select substrate, coating, finish, and printing technique.",
      requiredCapability: "material_selection",
      dependencies: ["concept"],
      optional: false,
      repeatable: false,
      parallel: true, // can run alongside dieline
    },
    {
      id: "mockup",
      label: "3D Mockup",
      description: "Generate photorealistic 3D mockup renders on selected materials.",
      requiredCapability: "3d_mockup",
      dependencies: ["material_selection"],
      optional: false,
      repeatable: true,
      parallel: false,
      artifactOutputs: [
        { artifactType: "mockup_render", required: true },
      ],
    },
    {
      id: "print_spec",
      label: "Print Specification",
      description: "Produce print-ready spec sheet including colour profiles and bleed marks.",
      requiredCapability: "print_specification",
      dependencies: ["mockup"],
      optional: true,
      repeatable: false,
      parallel: false,
      activationCondition: {
        type: "or",
        conditions: [
          { type: "deliverable", deliverables: ["print_ready"] },
          { type: "goal", goals: ["print_production"] },
        ],
      },
      artifactOutputs: [
        { artifactType: "print_spec_pdf", required: true },
      ],
    },
    {
      id: "export",
      label: "Export",
      description: "Package all deliverables into the agreed file format bundle.",
      requiredCapability: "export_preparation",
      dependencies: ["mockup"],
      optional: false,
      repeatable: false,
      parallel: false,
      artifactOutputs: [
        { artifactType: "export_zip", required: true },
      ],
    },
  ],
  completionPolicy: { type: "all_required" },
  fallbackBehavior: {
    onRequiredStageFailure: "pause_for_review",
    onOptionalStageFailure: "continue",
  },
  tags: ["packaging", "print", "3d", "export"],
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};
