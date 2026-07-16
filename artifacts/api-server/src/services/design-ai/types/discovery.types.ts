/**
 * Discovery Team — Shared Types
 *
 * Common contracts used by all three discovery agents
 * (Creative Director, Requirement Analyst, Brand Strategist).
 *
 * MASTER RULE: All agents must accept JSON input, return JSON output,
 * record latency/token usage, and support dependency injection for AI model.
 */

// ── Agent execution contract ──────────────────────────────────────────────────

export type AgentStatus = "success" | "failed" | "skipped";

export interface AgentExecutionMetadata {
  agentId: string;
  agentName: string;
  agentVersion: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  retryCount: number;
}

export interface AgentOutput<T> {
  status: AgentStatus;
  data: T | null;
  warnings: string[];
  errors: string[];
  metadata: AgentExecutionMetadata;
}

// ── Dependency injection — AI model ──────────────────────────────────────────

/**
 * Callers inject this to swap providers/models without touching agent logic.
 * Follows the ExecutionInput shape from aiExecutionService.ts.
 */
export interface AgentModelConfig {
  provider: {
    slug: string;
    baseUrl?: string | null;
  };
  model: {
    modelId: string;
    maxOutputTokens?: number | null;
  };
  temperature?: number;
  /** Max retry attempts on transient AI errors. Default: 2. */
  maxRetries?: number;
}

export const DEFAULT_MODEL_CONFIG: AgentModelConfig = {
  provider: { slug: "openai" },
  model: { modelId: "gpt-4o-mini", maxOutputTokens: 4096 },
  temperature: 0.3,
  maxRetries: 2,
};

// ── Discovery domain types ────────────────────────────────────────────────────

export interface CreativeBrief {
  designGoal: string;
  communicationObjective: string;
  campaignName?: string;
  campaignContext?: string;
  targetAudience: {
    primary: string;
    secondary?: string;
    characteristics: string[];
  };
  coreMessage: string;
  tone: string[];
  desiredEmotion: string[];
  visualDirection: string[];
  styleKeywords: string[];
  contentPriority: string[];
  assumptions: string[];
  missingInformation: string[];
}

export interface RequirementAnalysis {
  platform: string;
  language: string;
  canvas: {
    width: number;
    height: number;
    unit: "px";
    orientation: "portrait" | "landscape" | "square";
    preset?: string;
  };
  sections: Array<{
    id: string;
    name: string;
    required: boolean;
    contentPurpose: string;
  }>;
  callsToAction: Array<{
    label?: string;
    purpose: string;
    priority: "primary" | "secondary";
  }>;
  requestedVariables: string[];
  requiredContent: string[];
  optionalContent: string[];
  contentConstraints: string[];
  visualConstraints: string[];
  exportFormats: string[];
  explicitRequirements: string[];
  inferredRequirements: string[];
  conflicts: Array<{
    requirementA: string;
    requirementB: string;
    resolution?: string;
  }>;
  missingInformation: string[];
}

export interface BrandStrategy {
  brandName?: string;
  brandPersonality: string[];
  brandStyle: string[];
  mood: string[];
  visualKeywords: string[];
  colorDirection: {
    primaryMood: string;
    supportingMood: string[];
    avoid: string[];
    useExistingBrandPalette: boolean;
  };
  typographyDirection: {
    category: string[];
    personality: string[];
    readabilityPriority: "high" | "medium" | "low";
  };
  imageryDirection: string[];
  logoRules: string[];
  brandingRules: string[];
  forbiddenStyles: string[];
  assumptions: string[];
}

// ── Pipeline input / output ───────────────────────────────────────────────────

export interface DiscoveryPipelineInput {
  userPrompt: string;
  /** Optional: existing brand profile from the system (passed to Brand Strategist). */
  brandProfile?: Record<string, unknown>;
  /** Override default model for all agents. */
  modelConfig?: AgentModelConfig;
}

export interface DiscoveryTeamOutput {
  creativeBrief: CreativeBrief;
  requirementAnalysis: RequirementAnalysis;
  brandStrategy: BrandStrategy;
}
