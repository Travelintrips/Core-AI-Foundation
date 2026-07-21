/**
 * Design Workflow Engine — Zod Validation Schemas
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 */

import { z } from "zod";
import type { ConditionExpression } from "../types/definition.js";

// ── Condition Expression ──────────────────────────────────────────────────────

// Recursive — use ZodType<ConditionExpression> to avoid circular reference error
export const conditionExpressionSchema: z.ZodType<ConditionExpression> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("always") }),
    z.object({ type: z.literal("never") }),
    z.object({
      type: z.literal("context_field"),
      field: z.string().min(1),
      operator: z.enum(["eq", "neq", "in", "not_in", "exists", "not_exists"]),
      value: z.unknown().optional(),
    }),
    z.object({
      type: z.literal("goal"),
      goals: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      type: z.literal("deliverable"),
      deliverables: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      type: z.literal("service_type"),
      serviceTypes: z.array(z.string().min(1)).min(1),
    }),
    z.object({
      type: z.literal("and"),
      conditions: z.array(conditionExpressionSchema).min(1),
    }),
    z.object({
      type: z.literal("or"),
      conditions: z.array(conditionExpressionSchema).min(1),
    }),
    z.object({
      type: z.literal("not"),
      condition: conditionExpressionSchema,
    }),
  ]),
);

// ── Artifact Spec ─────────────────────────────────────────────────────────────

export const artifactSpecSchema = z.object({
  artifactType: z.string().min(1, "artifactType must not be empty"),
  required: z.boolean(),
  description: z.string().optional(),
});

// ── Review Gate ───────────────────────────────────────────────────────────────

export const reviewGateRefSchema = z.object({
  required: z.boolean(),
  approverRoles: z.array(z.string().min(1)).optional(),
  minimumApprovals: z.number().int().min(1).optional(),
  timeoutMs: z.number().int().min(0).optional(),
});

// ── Stage Definition ──────────────────────────────────────────────────────────

export const stageDefinitionSchema = z.object({
  id: z.string().min(1, "stage id must not be empty"),
  label: z.string().min(1, "stage label must not be empty"),
  description: z.string().optional(),
  requiredCapability: z.string().min(1, "requiredCapability must not be empty"),
  dependencies: z.array(z.string().min(1)),
  optional: z.boolean(),
  repeatable: z.boolean(),
  parallel: z.boolean(),
  activationCondition: conditionExpressionSchema.optional(),
  completionCondition: conditionExpressionSchema.optional(),
  reviewGate: reviewGateRefSchema.optional(),
  artifactOutputs: z.array(artifactSpecSchema).optional(),
  estimatedDurationMs: z.number().int().positive().optional(),
});

// ── Completion Policy ─────────────────────────────────────────────────────────

export const completionPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_required") }),
  z.object({ type: z.literal("all_stages") }),
  z.object({
    type: z.literal("any_of"),
    stageIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("all_of"),
    stageIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("milestone"),
    milestoneId: z.string().min(1),
  }),
]);

// ── Fallback Behaviour ────────────────────────────────────────────────────────

export const fallbackBehaviorSchema = z.object({
  onRequiredStageFailure: z.enum([
    "fail_workflow",
    "skip_to_next",
    "pause_for_review",
  ]),
  onOptionalStageFailure: z.enum(["continue", "pause_for_review"]),
});

// ── Migration Metadata ────────────────────────────────────────────────────────

export const migrationMetadataSchema = z.object({
  compatibleFromVersion: z.number().int().min(1),
  changelog: z.string().optional(),
  renamedStages: z.record(z.string(), z.string()).optional(),
  removedStages: z.array(z.string().min(1)).optional(),
});

// ── Workflow Definition ───────────────────────────────────────────────────────

export const designWorkflowDefinitionSchema = z
  .object({
    workflowId: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9_.-]+$/,
        "workflowId must be lowercase alphanumeric with _ . - only",
      ),
    version: z.number().int().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    pluginId: z.string().min(1),
    supportedServiceTypes: z.array(z.string().min(1)).min(1),
    stages: z.array(stageDefinitionSchema).min(1),
    requiredCapabilities: z.array(z.string().min(1)),
    completionPolicy: completionPolicySchema,
    fallbackBehavior: fallbackBehaviorSchema,
    migrationMetadata: migrationMetadataSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine((def, ctx) => {
    // version > 1 must have migrationMetadata
    if (def.version > 1 && !def.migrationMetadata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "migrationMetadata is required when version > 1",
        path: ["migrationMetadata"],
      });
    }
    // requiredCapabilities must include all stage capabilities
    const stageCapabilities = new Set<string>(
      def.stages.map((s) => String(s.requiredCapability)),
    );
    for (const cap of stageCapabilities) {
      if (!def.requiredCapabilities.includes(cap)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `requiredCapabilities missing capability "${cap}" used by a stage`,
          path: ["requiredCapabilities"],
        });
      }
    }
  });

export type DesignWorkflowDefinitionInput = z.infer<
  typeof designWorkflowDefinitionSchema
>;

