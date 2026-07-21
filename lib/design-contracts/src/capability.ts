/**
 * capability.ts — DesignCapabilityContract
 *
 * A capability is a discrete, reusable unit of work a plugin can perform.
 * Examples: "generate_moodboard_image", "render_technical_drawing", "export_pdf".
 *
 * Capabilities declare their input/output schemas by reference (opaque strings
 * resolved by the capability registry), not by value — this prevents the core
 * engine from depending on domain-specific schemas.
 *
 * Execution modes:
 *   - sync: result returned immediately in the capability response.
 *   - async_job: work queued as an AiJob; result polled via jobId.
 *   - streaming: result streamed incrementally (SSE/WebSocket).
 *   - background: fire-and-forget; result stored and polled separately.
 */

import { z } from "zod";

// ── Execution modes ───────────────────────────────────────────────────────────

export const EXECUTION_MODES = ["sync", "async_job", "streaming", "background"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

// ── Capability category (Task D) ──────────────────────────────────────────────

/**
 * Broad functional category of a capability.
 * Used by the plugin registry, developer tooling, and cost routing.
 *
 * - AI             — invokes an AI model (image generation, text, multimodal).
 * - Rendering      — produces a rendered file (PDF, PPTX, image composite).
 * - Simulation     — physics, material, or spatial simulation.
 * - Analysis       — computes quality scores, validates, or inspects content.
 * - Export         — converts or packages artifacts for delivery.
 * - Validation     — enforces constraints without producing new artifacts.
 * - Human Review   — pauses workflow for a human decision or approval.
 * - Automation     — runs a rule-engine or scripted transformation.
 * - Transformation — format or content conversion (e.g. SVG → PNG).
 * - Storage        — manages persistence: upload, archive, sign URLs.
 */
export const CAPABILITY_CATEGORIES = [
  "AI",
  "Rendering",
  "Simulation",
  "Analysis",
  "Export",
  "Validation",
  "Human Review",
  "Automation",
  "Transformation",
  "Storage",
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

// ── Execution priority (Task E) ───────────────────────────────────────────────

/**
 * Priority hint passed to the dispatcher when scheduling capability execution.
 * The dispatcher uses this to order the job queue; it is advisory, not a hard SLA.
 *
 * - critical   — Must run immediately; blocks a user-visible operation.
 * - high       — Important; should start within seconds.
 * - medium     — Standard; processed in order of arrival.
 * - low        — Deferred; runs when higher-priority slots are free.
 * - background — Best-effort; runs during off-peak periods.
 */
export const EXECUTION_PRIORITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "background",
] as const;

export type ExecutionPriority = (typeof EXECUTION_PRIORITIES)[number];

// ── Execution estimation (Task F) ─────────────────────────────────────────────

/**
 * Advisory cost and resource estimates for a single capability invocation.
 * All fields are optional — provide what is measurable; do not hardcode guesses.
 *
 * These values are used by:
 *   - Cost guards to reject unexpectedly expensive invocations.
 *   - UI to display progress estimates.
 *   - Scheduler to allocate resources.
 *
 * They describe a TYPICAL invocation, not worst-case.
 */
export const ExecutionEstimationSchema = z.object({
  /**
   * Typical wall-clock runtime in milliseconds.
   * For async_job capabilities, this is time from dispatch to completion.
   */
  estimatedRuntimeMs: z.number().int().positive().optional(),
  /**
   * Typical token consumption (input + output) for AI capabilities.
   * Omit for non-AI capabilities.
   */
  estimatedTokenUsage: z.number().int().positive().optional(),
  /**
   * Typical cost in USD for one invocation at default quality settings.
   */
  estimatedCostUsd: z.number().positive().optional(),
  /**
   * Peak memory required in megabytes.
   * Used by the scheduler to gate high-memory capabilities.
   */
  estimatedMemoryMb: z.number().positive().optional(),
  /**
   * Typical output artifact size in bytes.
   * Used for storage quota checks and pre-signed URL expiry tuning.
   */
  estimatedOutputSizeBytes: z.number().int().positive().optional(),
});

export type ExecutionEstimation = z.infer<typeof ExecutionEstimationSchema>;

// ── AI requirement ────────────────────────────────────────────────────────────

export const AiRequirementSchema = z.object({
  /**
   * Whether this capability requires an AI model.
   * When false, the capability is deterministic (rule-engine, template, etc.).
   */
  required: z.boolean(),
  /**
   * Preferred model capability class.
   * Examples: "text_generation", "image_generation", "multimodal".
   * Opaque to the core engine — resolved by the model router.
   */
  modelCapabilityClass: z.string().max(100).optional(),
  /**
   * Whether a fallback model is acceptable if the preferred class is unavailable.
   */
  allowFallback: z.boolean().default(true),
  /**
   * Maximum estimated cost in USD for a single invocation of this capability.
   * Used by the cost guard to reject unexpectedly expensive requests.
   */
  maxEstimatedCostUsd: z.number().positive().optional(),
});

export type AiRequirement = z.infer<typeof AiRequirementSchema>;

// ── Renderer / export requirements ───────────────────────────────────────────

export const RendererRequirementSchema = z.object({
  /**
   * Renderer type needed to produce the output artifact.
   * Examples: "pdf_renderer", "pptx_renderer", "image_compositor", "3d_renderer".
   * Opaque to the core engine — resolved by the renderer registry.
   */
  rendererType: z.string().max(100),
  /** Minimum renderer version required. */
  minRendererVersion: z.string().max(30).optional(),
  /** Output format produced by the renderer. */
  outputFormat: z.string().max(50).optional(),
});

export type RendererRequirement = z.infer<typeof RendererRequirementSchema>;

// ── DesignCapabilityContract ──────────────────────────────────────────────────

export const DesignCapabilityContractSchema = z.object({
  /**
   * Stable, globally unique capability identifier.
   * Format recommendation: "<pluginId>:<snake_case_name>"
   * (e.g. "fashion:generate_moodboard", "interior:render_floor_plan").
   */
  capabilityId: z.string().min(1).max(150).regex(/^[a-z][a-z0-9_:-]*$/, {
    message: "capabilityId must be lowercase alphanumeric with colons/underscores/hyphens",
  }),
  /** Human-readable capability label. */
  displayName: z.string().min(1).max(200),
  /**
   * Functional category of this capability (Task D).
   * Used for registry filtering, cost routing, and developer tooling.
   */
  category: z.enum(CAPABILITY_CATEGORIES).optional(),
  /**
   * Reference to the Zod schema (or JSON Schema) that validates this
   * capability's input. Resolved by the capability registry; opaque to core.
   */
  inputSchemaRef: z.string().min(1).max(300),
  /**
   * Reference to the Zod schema (or JSON Schema) that validates this
   * capability's output. Resolved by the capability registry; opaque to core.
   */
  outputSchemaRef: z.string().min(1).max(300),
  /**
   * Artifact types this capability accepts as input (Task G).
   * Opaque strings resolved by the capability registry; not validated against
   * DESIGN_ARTIFACT_TYPES to avoid coupling with the stage vocabulary.
   * Examples: ["image", "vector", "specification"]
   */
  inputArtifactTypes: z.array(z.string().min(1).max(100)).optional(),
  /**
   * Artifact types this capability produces as output (Task G).
   * Examples: ["image", "pdf", "vector"]
   */
  outputArtifactTypes: z.array(z.string().min(1).max(100)).optional(),
  /** How results are returned to the caller. */
  executionMode: z.enum(EXECUTION_MODES),
  /**
   * Dispatcher priority hint (Task E).
   * Defaults to "medium" — the dispatcher treats this as advisory.
   */
  executionPriority: z.enum(EXECUTION_PRIORITIES).default("medium"),
  /**
   * Advisory resource and cost estimates for one typical invocation (Task F).
   * All sub-fields are optional; omit rather than hardcode.
   */
  estimation: ExecutionEstimationSchema.optional(),
  /** AI model requirements; null for non-AI capabilities. */
  aiRequirement: AiRequirementSchema.nullable().default(null),
  /** Renderer requirements; null for capabilities that produce no rendered output. */
  rendererRequirement: RendererRequirementSchema.nullable().default(null),
  /**
   * Timeout in seconds. The core engine enforces this for async_job modes.
   * Default: 300 (5 minutes).
   */
  timeoutSeconds: z.number().int().positive().default(300),
  /**
   * Maximum number of concurrent executions allowed per tenant per project.
   * 0 = unlimited.
   */
  maxConcurrencyPerProject: z.number().int().nonnegative().default(1),
  /** Whether output from this capability should be cached for identical inputs. */
  cacheable: z.boolean().default(false),
  /** Opaque plugin-specific metadata. */
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type DesignCapabilityContract = z.infer<typeof DesignCapabilityContractSchema>;
