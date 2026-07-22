/**
 * branding-identity/agentAdapter.ts — Team 27
 *
 * Thin adapter wrapping EXISTING discovery agents for use in the Branding
 * & Identity plugin.
 *
 * RULES:
 *   - Does NOT re-implement any agent logic.
 *   - Does NOT duplicate brandStrategistAgent or creativeDirectorAgent.
 *   - Agents are imported by reference and called through their published API.
 *   - Dependency injection (AgentModelConfig) is forwarded unchanged.
 *
 * ─── Team 39 Integration Note ────────────────────────────────────────────────
 * This adapter is a LOCAL stub for Team 27 isolation. When Team 39 wires the
 * canonical integration layer, they should:
 *   1. Replace the direct agent imports with the canonical AgentCapability
 *      registry (capabilityService.ts) using capability IDs:
 *        - "discovery-brand-strategist"  (brandStrategistAgent)
 *        - "discovery-creative-director" (creativeDirectorAgent)
 *   2. Remove the direct imports from services/design-ai/agents/discovery/.
 *   3. Keep the BrandingAgentAdapter interface unchanged — the service layer
 *      depends on it via dependency injection.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  runBrandStrategistAgent,
  type BrandStrategistInput,
} from "../../services/design-ai/agents/discovery/brandStrategistAgent.js";
import {
  runCreativeDirectorAgent,
  type CreativeDirectorInput,
} from "../../services/design-ai/agents/discovery/creativeDirectorAgent.js";
import type {
  AgentOutput,
  AgentModelConfig,
  BrandStrategy,
  CreativeBrief,
} from "../../services/design-ai/types/discovery.types.js";

// ── Adapter interface (injected into service) ─────────────────────────────────

export interface BrandingAgentAdapter {
  /**
   * Run the Creative Director agent to extract a structured CreativeBrief
   * from a free-text user prompt.
   */
  extractCreativeBrief(
    userPrompt:  string,
    modelConfig?: AgentModelConfig,
  ): Promise<AgentOutput<CreativeBrief>>;

  /**
   * Run the Brand Strategist agent to produce a BrandStrategy from a
   * CreativeBrief and RequirementAnalysis.
   */
  runBrandStrategy(
    input: BrandStrategistInput,
  ): Promise<AgentOutput<BrandStrategy>>;
}

// ── Default adapter (backed by existing design-ai agents) ─────────────────────

export const defaultBrandingAgentAdapter: BrandingAgentAdapter = {
  async extractCreativeBrief(
    userPrompt:  string,
    modelConfig?: AgentModelConfig,
  ): Promise<AgentOutput<CreativeBrief>> {
    const input: CreativeDirectorInput = { userPrompt, modelConfig };
    return runCreativeDirectorAgent(input);
  },

  async runBrandStrategy(
    input: BrandStrategistInput,
  ): Promise<AgentOutput<BrandStrategy>> {
    return runBrandStrategistAgent(input);
  },
};

// ── Mock adapter for tests ────────────────────────────────────────────────────

export function makeMockBrandingAgentAdapter(
  overrides: Partial<BrandingAgentAdapter> = {},
): BrandingAgentAdapter {
  const now = new Date().toISOString();
  const meta = {
    agentId:      "mock",
    agentName:    "Mock Agent",
    agentVersion: "0.0.0",
    startedAt:    now,
    completedAt:  now,
    latencyMs:    0,
    retryCount:   0,
  };

  return {
    extractCreativeBrief: async () => ({
      status: "success",
      data: {
        designGoal:             "Build a cohesive brand identity",
        communicationObjective: "Establish recognition",
        targetAudience: {
          primary:         "Young professionals",
          characteristics: ["urban", "tech-savvy"],
        },
        coreMessage:      "Modern and trustworthy",
        tone:             ["professional", "approachable"],
        desiredEmotion:   ["trust", "excitement"],
        visualDirection:  ["clean", "bold"],
        styleKeywords:    ["minimal", "modern"],
        contentPriority:  ["logo", "colors"],
        assumptions:      [],
        missingInformation: [],
      },
      warnings: [],
      errors:   [],
      metadata: { ...meta, agentId: "discovery-creative-director", agentName: "Creative Director AI" },
    }),
    runBrandStrategy: async () => ({
      status: "success",
      data: {
        brandArchetype:    "Explorer",
        brandEssence:      "Bold simplicity",
        emotionalCore:     "Confidence",
        visualPersonality: ["clean lines", "strong contrast"],
        colorDirection:    "Monochromatic with an accent",
        typographyDirection: "Geometric sans-serif",
        moodWords:         ["dynamic", "clear", "modern"],
        strategicPillars:  ["quality", "innovation", "trust"],
        differentiators:   ["unique positioning"],
        constraints:       [],
      } as unknown as BrandStrategy,
      warnings: [],
      errors:   [],
      metadata: { ...meta, agentId: "discovery-brand-strategist", agentName: "Brand Strategist AI" },
    }),
    ...overrides,
  };
}
