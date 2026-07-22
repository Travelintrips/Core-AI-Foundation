/**
 * fashionWorkflowDefinition.ts — Fashion Design Plugin
 *
 * 11-step configurable fashion design workflow.
 * Uses the WorkflowDefinition contract from creative-workflow-v2 (Team 1 owned).
 *
 * Rules:
 *   - Do NOT create a second execution engine.
 *   - Do NOT hard-code AI provider or model names in jobType values.
 *   - jobType strings match capabilities registered in the worker cluster.
 *   - Workflow forms a valid DAG (no cycles).
 *   - Edges use "on_success" by default — each step only starts when the prior succeeds.
 */

import type { WorkflowDefinition } from "../../../../types/creative-workflow-v2/workflow.js";

/** Stable ID for the Fashion Design Workflow Definition. */
export const FASHION_WORKFLOW_ID = "8f3a1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b" as const;

export const fashionWorkflowDefinition: WorkflowDefinition = {
  id: FASHION_WORKFLOW_ID,
  name: "Fashion Design — Full Production Workflow",
  version: 1,
  description:
    "End-to-end 11-step fashion design workflow: from brief intake to final export. " +
    "Each step produces a versioned design artifact. Steps are configurable — individual " +
    "nodes can be skipped or substituted by the execution engine without modifying this definition.",
  tags: ["fashion", "design", "apparel", "domain-plugin"],

  nodes: [
    // ── Step 1: Brief ─────────────────────────────────────────────────────────
    {
      id: "brief",
      label: "Brief & Design Intent",
      jobType: "fashion.brief.validate",
      estimatedDurationMs: 60_000,
      metadata: {
        artifactTypeId: null, // brief step produces no artifact
        uiStep: 1,
        configurable: true,
      },
    },

    // ── Step 2: Research / Reference ─────────────────────────────────────────
    {
      id: "research",
      label: "Research & Reference Gathering",
      jobType: "fashion.research.compile",
      dependencies: ["brief"],
      estimatedDurationMs: 300_000,
      estimatedCost: 0.05,
      retryPolicy: { maxRetry: 2, strategy: "exponential", backoffMs: 5_000 },
      metadata: { artifactTypeId: null, uiStep: 2, configurable: true },
    },

    // ── Step 3: Moodboard ─────────────────────────────────────────────────────
    {
      id: "moodboard",
      label: "Moodboard Creation",
      jobType: "fashion.moodboard.generate",
      dependencies: ["research"],
      estimatedDurationMs: 600_000,
      estimatedCost: 0.20,
      retryPolicy: { maxRetry: 2, strategy: "exponential", backoffMs: 8_000 },
      metadata: { artifactTypeId: "fashion_moodboard", uiStep: 3, configurable: true },
    },

    // ── Step 4: Creative Direction ────────────────────────────────────────────
    {
      id: "creative_direction",
      label: "Creative Direction",
      jobType: "fashion.creative_direction.define",
      dependencies: ["moodboard"],
      estimatedDurationMs: 240_000,
      estimatedCost: 0.08,
      retryPolicy: { maxRetry: 2, strategy: "exponential", backoffMs: 5_000 },
      metadata: { artifactTypeId: "fashion_creative_direction", uiStep: 4, configurable: true },
    },

    // ── Step 5: Concept Sketch ────────────────────────────────────────────────
    {
      id: "concept_sketch",
      label: "Concept Sketch",
      jobType: "fashion.concept_sketch.generate",
      dependencies: ["creative_direction"],
      estimatedDurationMs: 900_000,
      estimatedCost: 0.35,
      retryPolicy: { maxRetry: 3, strategy: "exponential", backoffMs: 10_000 },
      metadata: { artifactTypeId: "fashion_concept_sketch", uiStep: 5, configurable: true },
    },

    // ── Step 6: Technical Drawing ─────────────────────────────────────────────
    {
      id: "technical_drawing",
      label: "Technical Drawing (Flat Sketch)",
      jobType: "fashion.technical_drawing.generate",
      dependencies: ["concept_sketch"],
      estimatedDurationMs: 1_200_000,
      estimatedCost: 0.45,
      retryPolicy: { maxRetry: 3, strategy: "exponential", backoffMs: 12_000 },
      metadata: { artifactTypeId: "fashion_technical_drawing", uiStep: 6, configurable: false },
    },

    // ── Step 7: Colorway ──────────────────────────────────────────────────────
    {
      id: "colorway",
      label: "Colorway Definition",
      jobType: "fashion.colorway.define",
      dependencies: ["technical_drawing"],
      estimatedDurationMs: 300_000,
      estimatedCost: 0.10,
      retryPolicy: { maxRetry: 2, strategy: "exponential", backoffMs: 5_000 },
      metadata: { artifactTypeId: "fashion_colorway", uiStep: 7, configurable: true },
    },

    // ── Step 8: Material Assignment ───────────────────────────────────────────
    {
      id: "material_assignment",
      label: "Material & Fabric Assignment",
      jobType: "fashion.material_assignment.compile",
      dependencies: ["colorway"],
      estimatedDurationMs: 360_000,
      estimatedCost: 0.08,
      retryPolicy: { maxRetry: 2, strategy: "immediate" },
      metadata: { artifactTypeId: "fashion_material_board", uiStep: 8, configurable: true },
    },

    // ── Step 9: Visualization ─────────────────────────────────────────────────
    {
      id: "visualization",
      label: "Fashion Visualization (Styled Render)",
      jobType: "fashion.visualization.render",
      dependencies: ["material_assignment"],
      estimatedDurationMs: 1_800_000,
      estimatedCost: 0.60,
      retryPolicy: { maxRetry: 3, strategy: "exponential", backoffMs: 15_000 },
      failover: {
        fallbackNodeId: "visualization_fallback",
        propagateError: true,
      },
      metadata: { artifactTypeId: "fashion_visualization", uiStep: 9, configurable: true },
    },

    // ── Step 9-fallback: Visualization Fallback ───────────────────────────────
    {
      id: "visualization_fallback",
      label: "Visualization Fallback (Simplified Render)",
      jobType: "fashion.visualization.render_simplified",
      // Not in the main DAG path — only activated by failover from visualization
      estimatedDurationMs: 600_000,
      estimatedCost: 0.20,
      retryPolicy: { maxRetry: 1, strategy: "immediate" },
      metadata: { artifactTypeId: "fashion_visualization", uiStep: 9, isFallback: true },
    },

    // ── Step 10: Review ───────────────────────────────────────────────────────
    {
      id: "review",
      label: "Design Review & QA",
      jobType: "fashion.review.qa",
      dependencies: ["visualization"],
      estimatedDurationMs: 300_000,
      estimatedCost: 0.05,
      retryPolicy: { maxRetry: 2, strategy: "immediate" },
      metadata: { artifactTypeId: null, uiStep: 10, configurable: false },
    },

    // ── Step 11: Export ───────────────────────────────────────────────────────
    {
      id: "export",
      label: "Export & Delivery Packaging",
      jobType: "fashion.export.package",
      dependencies: ["review"],
      estimatedDurationMs: 180_000,
      estimatedCost: 0.02,
      retryPolicy: { maxRetry: 2, strategy: "immediate" },
      metadata: { artifactTypeId: "fashion_production_spec", uiStep: 11, configurable: true },
    },
  ],

  edges: [
    { from: "brief",              to: "research",           condition: "on_success" },
    { from: "research",           to: "moodboard",          condition: "on_success" },
    { from: "moodboard",          to: "creative_direction", condition: "on_success" },
    { from: "creative_direction", to: "concept_sketch",     condition: "on_success" },
    { from: "concept_sketch",     to: "technical_drawing",  condition: "on_success" },
    { from: "technical_drawing",  to: "colorway",           condition: "on_success" },
    { from: "colorway",           to: "material_assignment",condition: "on_success" },
    { from: "material_assignment",to: "visualization",      condition: "on_success" },
    { from: "visualization",      to: "review",             condition: "on_success" },
    { from: "review",             to: "export",             condition: "on_success" },
  ],

  milestones: [
    {
      id: "creative_foundation",
      label: "Creative Foundation Complete",
      requiresAllOf: ["moodboard", "creative_direction"],
    },
    {
      id: "design_documentation",
      label: "Design Documentation Complete",
      requiresAllOf: ["concept_sketch", "technical_drawing", "colorway", "material_assignment"],
    },
    {
      id: "production_ready",
      label: "Production Ready",
      requiresAllOf: ["review", "export"],
    },
  ],

  defaultRetryPolicy: {
    maxRetry: 2,
    strategy: "exponential",
    backoffMs: 5_000,
    maxBackoffMs: 60_000,
  },

  createdAt: new Date("2026-07-22T00:00:00.000Z"),
  updatedAt: new Date("2026-07-22T00:00:00.000Z"),
};
