/**
 * Team 31 — Universal Design AI Orchestration Adapter
 * types.ts — Contract types for the adapter layer.
 *
 * All names prefixed with `DesignAi` to avoid collision with
 * existing orchestrator types (GenerateDesignTemplateInput, etc.).
 *
 * Design rules:
 *  - No raw provider API key on any surface.
 *  - No provider/model field that a customer can use as authoritative input.
 *  - No secrets in output, no raw chain-of-thought.
 *  - All outputs carry provenance and cost-record references.
 */

import type { RequestContext } from "../../../security/requestContext.js";

// ─── Error codes ──────────────────────────────────────────────────────────────

export const DESIGN_AI_ERROR_CODES = [
  "capability_not_found",
  "capability_incompatible",
  "invalid_input",
  "budget_exceeded",
  "guardrail_blocked",
  "provider_unavailable",
  "model_unavailable",
  "timeout",
  "rate_limited",
  "job_failed",
  "invalid_output",
  "canceled",
  "tenant_scope_violation",
  "duplicate_request_conflict",
] as const;

export type DesignAiErrorCode = (typeof DESIGN_AI_ERROR_CODES)[number];

// ─── Budget & quality policy ──────────────────────────────────────────────────

export interface DesignAiBudgetPolicy {
  /** Maximum total USD spend for this request. 0 = use platform default. */
  maxCostUsd: number;
  /** Warn (but not block) when estimated cost exceeds this fraction of maxCostUsd. */
  warnThresholdFraction?: number;
}

export interface DesignAiQualityPolicy {
  /** Minimum QC score (0–100) for the output to be accepted. */
  minQcScore?: number;
  /** Whether a human review step is required before finalising output. */
  requireHumanReview?: boolean;
  /** Allow output with warnings (default true). */
  allowWarnings?: boolean;
}

// ─── Input / output artifact descriptors ─────────────────────────────────────

export interface DesignAiArtifactDescriptor {
  /** Canonical artifact type identifier, e.g. "creative_brief", "image", "template". */
  type: string;
  /** Optional storage URL or content identifier. Never a raw secret. */
  ref?: string;
  /** Opaque metadata: dimensions, mime-type, schema version, etc. */
  meta?: Record<string, string | number | boolean>;
}

// ─── Actor context (subset of RequestContext safe to forward) ─────────────────

export interface DesignAiActorContext {
  actorId: string | null;
  actorType: string;
  correlationId: string;
  requestId: string;
}

// ─── Request ──────────────────────────────────────────────────────────────────

/**
 * DesignAiExecutionRequest
 *
 * Everything the adapter needs to route, validate, plan, and enqueue
 * a design AI execution. The adapter never reads a raw API key from here.
 * Provider preference is advisory only (honoured only when platform policy
 * permits).
 */
export interface DesignAiExecutionRequest {
  /** Server-resolved tenant id. Never from unverified client input. */
  tenantId: string;

  /** UUID of the creative project this execution belongs to. */
  projectId: string;

  /** Workflow definition id — references an existing workflow in the platform. */
  workflowId: string;

  /** Stage within the workflow, e.g. "discovery", "design", "engineering". */
  stageId: string;

  /** Canonical capability identifier, e.g. "brand_strategy", "layout_design". */
  capabilityId: string;

  /** Plugin that owns this capability. Used for ownership validation. */
  pluginId: string;

  /** Input artifacts for this execution step. */
  inputArtifacts: DesignAiArtifactDescriptor[];

  /** Structured brief context — passed to agents, never to external APIs raw. */
  briefContext: Record<string, unknown>;

  /** Typed parameters for the capability (schema validated by resolver). */
  parameters: Record<string, unknown>;

  /** Requested output artifact types. */
  requestedOutputTypes: string[];

  /**
   * Idempotency key — caller-supplied; combined with tenantId+capabilityId
   * to produce the canonical idempotency hash used by the job engine.
   */
  idempotencyKey: string;

  /** Budget constraints for this request. */
  budgetPolicy: DesignAiBudgetPolicy;

  /** Quality requirements for the output. */
  qualityPolicy: DesignAiQualityPolicy;

  /** Propagated from the outer request for tracing. */
  correlationId: string;

  /** Actor context — derived server-side from RequestContext. */
  actorContext: DesignAiActorContext;

  /**
   * Advisory provider preference. Only considered when platform policy
   * explicitly allows caller-directed routing. Never authoritative.
   */
  preferredProviderSlug?: string;

  /** Contract version of the capability being invoked. */
  capabilityContractVersion?: string;
}

// ─── Context (request + resolved auth context) ───────────────────────────────

/**
 * DesignAiExecutionContext
 *
 * Combines the validated DesignAiExecutionRequest with the server-resolved
 * RequestContext. This is the single object passed through the resolution
 * and execution pipeline.
 */
export interface DesignAiExecutionContext {
  request: DesignAiExecutionRequest;
  /** Canonical server-resolved auth context. Never from client input. */
  authContext: RequestContext;
  /** Wall-clock timestamp when the adapter accepted the request. */
  receivedAt: Date;
}

// ─── Capability binding ───────────────────────────────────────────────────────

/**
 * DesignAiCapabilityBinding
 *
 * The result of capability resolution — fully validated before any execution
 * begins. Contains all the information needed to build an execution plan.
 */
export interface DesignAiCapabilityBinding {
  capabilityId: string;
  pluginId: string;
  /** Agent slug that implements this capability. */
  agentSlug: string;
  /** Resolved contract version. */
  contractVersion: string;
  /** Execution mode determined by capability definition. */
  executionMode: "sync" | "async_job" | "sequential" | "parallel";
  /** Whether a QC validation step is required. */
  requiresQcStep: boolean;
  /** Whether a human review gate is required. */
  requiresHumanReview: boolean;
  /** Capability DB id (if resolved from matrix). Null if resolved from registry. */
  capabilityDbId: number | null;
  /** Resolved skill identifier for model routing. */
  skill: string;
}

// ─── Execution plan ───────────────────────────────────────────────────────────

export type DesignAiPlanStepKind =
  | "single_agent"
  | "sequential_agents"
  | "parallel_agents"
  | "validation"
  | "transformation"
  | "qc"
  | "human_review";

export interface DesignAiPlanStep {
  stepId: string;
  kind: DesignAiPlanStepKind;
  /** Agent slugs to invoke for this step. */
  agentSlugs: string[];
  /** Whether this step can be skipped if earlier step already produced valid output. */
  skipIfOutputAvailable?: boolean;
}

/**
 * DesignAiExecutionPlan
 *
 * Derived from existing workflow/capability definitions. Team 31 does NOT
 * invent a new workflow engine — it builds a plan that is executed by the
 * existing job engine and orchestrator.
 */
export interface DesignAiExecutionPlan {
  planId: string;
  capabilityBinding: DesignAiCapabilityBinding;
  steps: DesignAiPlanStep[];
  estimatedCostUsd: number;
  timeoutMs: number;
}

// ─── Job payload ──────────────────────────────────────────────────────────────

/**
 * DesignAiJobPayload
 *
 * Stamped into ai_jobs.payload_json by the adapter when enqueuing via
 * queueManagerService. Workers read this to reconstruct execution context.
 * No raw API keys. No secrets.
 */
export interface DesignAiJobPayload {
  _type: "design_ai_orchestration";
  _version: "1.0";
  /** Canonical idempotency hash (SHA-256 of tenantId+capabilityId+idempotencyKey). */
  idempotencyHash: string;
  tenantId: string;
  projectId: string;
  workflowId: string;
  stageId: string;
  capabilityId: string;
  pluginId: string;
  agentSlug: string;
  skill: string;
  executionMode: DesignAiCapabilityBinding["executionMode"];
  briefContext: Record<string, unknown>;
  parameters: Record<string, unknown>;
  inputArtifacts: DesignAiArtifactDescriptor[];
  requestedOutputTypes: string[];
  budgetPolicy: DesignAiBudgetPolicy;
  qualityPolicy: DesignAiQualityPolicy;
  correlationId: string;
  actorContext: DesignAiActorContext;
}

// ─── Output envelope ──────────────────────────────────────────────────────────

export type DesignAiValidationStatus = "passed" | "failed" | "skipped" | "pending_review";

export interface DesignAiProvenance {
  /** Provider slug — safe to surface (not an API key). */
  providerSlug: string;
  /** Model id — safe to surface. */
  modelId: string;
  /** Capability id used. */
  capabilityId: string;
  /** Agent slug that produced the output. */
  agentSlug: string;
  /** Contract version. */
  contractVersion: string;
  /** Adapter version. */
  adapterVersion: "1.0";
}

/**
 * DesignAiOutputEnvelope
 *
 * Structured, versioned wrapper for all output produced by the adapter.
 * - No secrets.
 * - No raw chain-of-thought.
 * - Carries cost-record reference, job id, provenance, validation status, warnings.
 */
export interface DesignAiOutputEnvelope {
  _type: "design_ai_output";
  _version: "1.0";
  jobId: number | null;
  jobCode: string | null;
  /** Whether the job was enqueued async or executed synchronously. */
  executionMode: DesignAiCapabilityBinding["executionMode"];
  provenance: DesignAiProvenance;
  /** Artifact descriptors produced by this execution. */
  outputArtifacts: DesignAiArtifactDescriptor[];
  validationStatus: DesignAiValidationStatus;
  /** Non-blocking warnings. Output is still valid unless validationStatus=failed. */
  warnings: string[];
  /** Cost record project id for cross-referencing ai_cost_records. */
  costRecordProjectId: string;
  /** Estimated cost in USD at time of enqueue. Actual cost recorded by worker. */
  estimatedCostUsd: number;
  /** Idempotency hash — can be used to detect duplicate responses. */
  idempotencyHash: string;
  correlationId: string;
  enqueuedAt: string;
}

// ─── Execution result (top-level) ─────────────────────────────────────────────

/**
 * DesignAiExecutionResult
 *
 * Union of success and error outcomes returned by the adapter.
 */
export type DesignAiExecutionResult =
  | { ok: true; output: DesignAiOutputEnvelope }
  | { ok: false; error: DesignAiExecutionError };

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * DesignAiExecutionError
 *
 * Typed error from any stage of the adapter pipeline.
 * Never carries secrets or raw stack traces in `details`.
 */
export interface DesignAiExecutionError {
  code: DesignAiErrorCode;
  message: string;
  /** Safe key-value details — no secrets, no raw traces. */
  details?: Record<string, string | number | boolean | null>;
  /** Whether retrying the same request might succeed. */
  retryable: boolean;
}
