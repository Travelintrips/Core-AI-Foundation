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
   * Reference to the Zod schema (or JSON Schema) that validates this
   * capability's input. Resolved by the capability registry; opaque to core.
   */
  inputSchemaRef: z.string().min(1).max(300),
  /**
   * Reference to the Zod schema (or JSON Schema) that validates this
   * capability's output. Resolved by the capability registry; opaque to core.
   */
  outputSchemaRef: z.string().min(1).max(300),
  /** How results are returned to the caller. */
  executionMode: z.enum(EXECUTION_MODES),
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
