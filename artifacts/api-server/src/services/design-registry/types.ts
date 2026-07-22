/**
 * types.ts — Core type definitions for the Universal Design Platform
 * Schema & Capability Registry.
 *
 * These types are the shared contract consumed by:
 *   - DesignSchemaRegistry    (schema ID / version / validator)
 *   - DesignCapabilityRegistry (capability → schema binding + execution metadata)
 *   - CapabilityResolver      (resolution results with explainability)
 *   - WorkerAvailabilityPort  (dependency-injection interface, no provider hard-coding)
 */

import { z } from "zod/v4";

// ── Schema Categories ─────────────────────────────────────────────────────────

export const SCHEMA_CATEGORIES = [
  "brief",
  "workflow",
  "artifact",
  "material",
  "component",
  "annotation",
  "technical_specification",
  "export_manifest",
] as const;

export type SchemaCategory = (typeof SCHEMA_CATEGORIES)[number];
export const schemaCategorySchema = z.enum(SCHEMA_CATEGORIES);

// ── Execution Kinds ───────────────────────────────────────────────────────────

export const EXECUTION_KINDS = [
  "pure",          // deterministic, no AI or renderer
  "ai_text",       // LLM text generation
  "ai_image",      // image diffusion / generation
  "render",        // template / canvas renderer
  "document",      // PDF document engine
  "presentation",  // PPTX / slide engine
  "export",        // packaging / ZIP / format conversion
  "human_review",  // platform-side gating (no worker)
  "composite",     // multi-step combining several kinds
] as const;

export type ExecutionKind = (typeof EXECUTION_KINDS)[number];
export const executionKindSchema = z.enum(EXECUTION_KINDS);

// ── Workflow Stages ───────────────────────────────────────────────────────────

export const WORKFLOW_STAGES = [
  "brief",
  "moodboard",
  "concept",
  "technical_design",
  "material_selection",
  "visualization",
  "production_specification",
  "export",
  "client_review",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export const workflowStageSchema = z.enum(WORKFLOW_STAGES);

// ── Schema Registry Entry ─────────────────────────────────────────────────────

export interface SchemaCompatibilityMetadata {
  /** Minimum schema version this entry is compatible with (inclusive, semver prefix). */
  minVersion?: string;
  /** Maximum schema version this entry is compatible with (inclusive, semver prefix). */
  maxVersion?: string;
  /** Alternative IDs that should resolve to this schema. */
  aliases?: string[];
}

export interface DesignSchemaEntry {
  /** Unique schema identifier, e.g. "design.brief.fashion". */
  id: string;
  /** Semver-style version string, e.g. "1.0.0". */
  version: string;
  category: SchemaCategory;
  /** Zod validator for data conforming to this schema. */
  validator: z.ZodType;
  compatibilityMetadata: SchemaCompatibilityMetadata;
  description?: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: z.ZodIssue[];
}

// ── Capability Registry Entry ─────────────────────────────────────────────────

export interface CapabilityGuardrailOverrides {
  /** Override max cost per request (USD). */
  maxCostPerRequest?: number;
  /** Override provider timeout in ms. */
  providerTimeoutMs?: number;
  /** Override fallback behaviour. */
  fallbackEnabled?: boolean;
  /** Override max retries per provider. */
  maxRetryPerProvider?: number;
}

export interface DesignCapabilityEntry {
  /**
   * Unique identifier for this design capability.
   * Convention: "design:<domain>:<stage>:<action>", e.g. "design:fashion:brief:analyze".
   */
  id: string;
  /**
   * Reference to an existing ai_capabilities.skill value when the semantic
   * is identical to an already-seeded capability.  Allows the model router
   * to reuse existing scoring data.
   */
  aiCapabilityRef?: string;
  /** Which Universal Design workflow stages this capability can serve. */
  stageApplicability: WorkflowStage[];
  executionKind: ExecutionKind;
  /** ID (without version) of the registered input DesignSchemaEntry. */
  inputSchemaId: string;
  /** ID (without version) of the registered output DesignSchemaEntry. */
  outputSchemaId: string;
  /** Named renderer services required by this capability. */
  rendererDependencies?: string[];
  /** Named export-format handlers required by this capability. */
  exportDependencies?: string[];
  /** Fine-grained guardrail overrides for this capability (merged on top of global config). */
  guardrailOverrides?: CapabilityGuardrailOverrides;
  /** Whether each invocation must emit a cost_record. */
  costObservabilityRequired: boolean;
  description?: string;
  /** Design domain tag, e.g. "fashion", "interior", "packaging". */
  domain?: string;
}

// ── Resolution & Availability ─────────────────────────────────────────────────

export type CapabilityResolveResult =
  | { found: true; capability: DesignCapabilityEntry; explanation: string }
  | { found: false; capabilityId: string; explanation: string };

export interface CapabilityAvailabilityResult {
  available: boolean;
  capabilityId: string;
  /** Human-readable reason for the availability determination. */
  reason: string;
  /** Which worker type was consulted (omitted for platform-managed execution kinds). */
  workerType?: string;
}

// ── Dependency-injection ports ────────────────────────────────────────────────

/**
 * Port for checking which worker types are currently registered in the cluster.
 * Implementations must NOT make direct AI provider calls.
 */
export interface WorkerAvailabilityPort {
  getRegisteredWorkerTypes(): Promise<string[]>;
}
