/**
 * QA Team — Type Definitions (Agent 15 + orchestrator gate)
 *
 * MASTER RULE: All agents must accept JSON input, return JSON output,
 * record latency/token usage, and support dependency injection for AI model.
 */

import type { AgentExecutionMetadata } from "./discovery.types.js";
import type { DesignTeamOutput, ComponentTeamOutput, EngineeringPipelineOutput } from "./orchestrator.types.js";
import type { DiscoveryTeamOutput } from "./discovery.types.js";

// Re-export shared metadata type for convenience
export type { AgentExecutionMetadata };

// ── QA scores ─────────────────────────────────────────────────────────────────

export interface QaScores {
  premiumAppearance: number;
  visualBalance: number;
  modernity: number;
  hierarchy: number;
  readability: number;
  ctaVisibility: number;
  brandConsistency: number;
  typographyQuality: number;
  colorHarmony: number;
  spacingConsistency: number;
  contentCompleteness: number;
}

// ── Issue categories and severity ─────────────────────────────────────────────

export type IssueCategory =
  | "layout"
  | "composition"
  | "typography"
  | "color"
  | "decoration"
  | "component"
  | "binding"
  | "engineering"
  | "validation";

export type IssueSeverity = "blocking" | "major" | "minor";

export type RevisionTarget =
  | "layout-architect"
  | "composition-designer"
  | "typography-designer"
  | "color-designer"
  | "decoration-designer"
  | "component-builder"
  | "variable-designer"
  | "asset-planner"
  | "json-architect"
  | "optimizer";

export interface BlockingIssue {
  code: string;
  category: IssueCategory;
  severity: IssueSeverity;
  message: string;
  affectedNodeIds: string[];
  recommendedAgent: RevisionTarget;
}

// ── QA report ─────────────────────────────────────────────────────────────────

export interface ArtDirectorQaReport {
  overallScore: number;
  scores: QaScores;
  readyToPublish: boolean;
  blockingIssues: BlockingIssue[];
  warnings: string[];
  recommendations: string[];
  metadata: AgentExecutionMetadata;
}

// ── QA agent input ────────────────────────────────────────────────────────────

export interface ArtDirectorQaInput {
  userPrompt: string;
  discovery: DiscoveryTeamOutput;
  design: DesignTeamOutput;
  components: ComponentTeamOutput;
  engineering: EngineeringPipelineOutput;
  modelConfig?: import("./discovery.types.js").AgentModelConfig;
}

// ── Deterministic gate result ─────────────────────────────────────────────────

export interface QaGateResult {
  publishReady: boolean;
  reason: string;
  /** Individual gate checks — all must pass */
  checks: Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }>;
}

// ── Revision router ───────────────────────────────────────────────────────────

export interface RevisionDecision {
  required: boolean;
  targetAgent?: RevisionTarget;
  issueCodes: string[];
  reason: string;
  affectedNodeIds: string[];
  priority: "blocking" | "major" | "minor";
}
