/**
 * Orchestrator — Type Definitions
 *
 * Includes:
 *  - Stub contracts for Teams 2, 3, 4 (placeholder until those teams deliver)
 *  - GenerateDesignTemplateInput / DesignGenerationResult for the final orchestrator
 *  - PipelineStageState / PipelineMetrics
 *
 * CONTRACT MISMATCH NOTICE:
 *   Teams 2, 3, and 4 have not yet delivered their pipelines.
 *   DesignTeamOutput, ComponentTeamOutput, and EngineeringPipelineOutput below
 *   are Team 5 stubs. When those teams deliver, update the stub types here and
 *   the corresponding adapter functions without touching Team 1 or QA agent files.
 */

import type { DiscoveryTeamOutput, AgentModelConfig } from "./discovery.types.js";
import type { DesignTemplate } from "../../../types/designTemplate.js";
import type { ArtDirectorQaReport, RevisionTarget } from "./qa.types.js";

// ── ── STUB TYPES (Teams 2–4) ──────────────────────────────────────────────────
// These will be replaced when those teams deliver their pipelines.

/** STUB — Team 2: Design Team output */
export interface DesignTeamOutput {
  layoutDecisions: {
    gridSystem: string;
    sectionOrder: string[];
    densityRating: "low" | "medium" | "high";
  };
  compositionNotes: string[];
  typographyChoices: {
    primaryCategory: string;
    secondaryCategory?: string;
    hierarchyLevels: number;
  };
  colorSystemNotes: string[];
  decorationNotes: string[];
  /** Raw agent metadata for metrics aggregation */
  _agentMetadata?: import("./discovery.types.js").AgentExecutionMetadata[];
}

/** STUB — Team 3: Component Team output */
export interface ComponentTeamOutput {
  componentPlan: Array<{
    id: string;
    type: string;
    purpose: string;
  }>;
  variableKeys: string[];
  assetBindings: Array<{
    variableKey: string;
    assetType: string;
  }>;
  /** Raw agent metadata for metrics aggregation */
  _agentMetadata?: import("./discovery.types.js").AgentExecutionMetadata[];
}

/** Final validation result from Team 4 */
export interface EngineeringValidation {
  passed: boolean;
  errors: string[];
  warnings: string[];
  /** Out-of-bounds element IDs */
  outOfBoundsIds?: string[];
  /** Missing variable binding keys */
  missingBindings?: string[];
  /** Element IDs where CTA is obscured */
  ctaCoveredIds?: string[];
}

/** STUB — Team 4: Engineering Pipeline output */
export interface EngineeringPipelineOutput {
  /** The validated, optimized template JSON — canonical DesignTemplate */
  optimizedTemplate: DesignTemplate;
  /** Final validation result from Team 4 Validator */
  finalValidation: EngineeringValidation;
  /** Raw agent metadata for metrics aggregation */
  _agentMetadata?: import("./discovery.types.js").AgentExecutionMetadata[];
}

// ── Pipeline stage ─────────────────────────────────────────────────────────────

export type PipelineStageStatus =
  | "pending"
  | "running"
  | "retrying"
  | "success"
  | "failed"
  | "skipped"
  | "needs_revision";

export type AgentName =
  | "creative-director"
  | "requirement-analyst"
  | "brand-strategist"
  | "layout-architect"
  | "composition-designer"
  | "typography-designer"
  | "color-designer"
  | "decoration-designer"
  | "component-builder"
  | "variable-designer"
  | "asset-planner"
  | "json-architect"
  | "validator-initial"
  | "optimizer"
  | "validator-final"
  | "art-director-qa"
  | "publish-gate"
  | "revision-router";

export interface PipelineStageState {
  stageId: AgentName;
  /** User-friendly label for the frontend */
  label: string;
  status: PipelineStageStatus;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  retryCount?: number;
  errorMessage?: string;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface PipelineAgentMetric {
  agentId: string;
  agentName: string;
  model?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  retryCount: number;
  status: "success" | "failed" | "skipped";
}

export interface PipelineMetrics {
  totalLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  totalRetries: number;
  agents: PipelineAgentMetric[];
}

// ── Orchestrator input ─────────────────────────────────────────────────────────

export interface GenerateDesignTemplateInput {
  tenantId: string;
  actorId: string;
  prompt: string;
  requestId?: string;
  brandProfileId?: string;
  canvasPreset?: string;
  language?: string;
  /** Override model per agent. Key = AgentName, value = modelId string. */
  modelOverrides?: Partial<Record<AgentName, string>>;
}

// ── Orchestrator result ────────────────────────────────────────────────────────

export type DesignGenerationStatus =
  | "ready"
  | "needs_revision"
  | "needs_human_review"
  | "failed";

export interface RevisionHistoryEntry {
  cycle: number;
  targetAgent: RevisionTarget;
  issueCodes: string[];
  startedAt: string;
  completedAt: string;
  outcome: "resolved" | "unresolved" | "failed";
}

export interface PipelineError {
  stage: string;
  agent?: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface DesignGenerationResult {
  status: DesignGenerationStatus;
  pipelineRunId: string;
  revisionCount: number;
  template?: DesignTemplate;
  discovery?: DiscoveryTeamOutput;
  design?: DesignTeamOutput;
  components?: ComponentTeamOutput;
  engineering?: EngineeringPipelineOutput;
  qa?: ArtDirectorQaReport;
  revisionHistory: RevisionHistoryEntry[];
  stages: PipelineStageState[];
  errors: PipelineError[];
  metrics: PipelineMetrics;
}

// ── Feature flag ──────────────────────────────────────────────────────────────

/**
 * Evaluates DESIGN_AI_MULTI_AGENT_ENABLED flag.
 * Priority: tenant override (future) → env var → default false.
 */
export function isMultiAgentDesignEnabled(_tenantId?: string): boolean {
  return process.env.DESIGN_AI_MULTI_AGENT_ENABLED === "true";
}

// ── Error codes ───────────────────────────────────────────────────────────────

export type PipelineErrorCode =
  | "provider_timeout"
  | "provider_rate_limit"
  | "invalid_ai_json"
  | "schema_validation_failed"
  | "pipeline_contract_failed"
  | "engineering_validation_failed"
  | "qa_rejected"
  | "revision_exhausted"
  | "unauthorized"
  | "tenant_scope_missing"
  | "unexpected_error";

/** Model config shorthand: build an AgentModelConfig for a given modelId */
export function makeModelConfig(
  modelId: string,
  providerSlug = "openai",
): AgentModelConfig {
  return {
    provider: { slug: providerSlug },
    model: { modelId, maxOutputTokens: 4096 },
    temperature: 0.3,
    maxRetries: 2,
  };
}
