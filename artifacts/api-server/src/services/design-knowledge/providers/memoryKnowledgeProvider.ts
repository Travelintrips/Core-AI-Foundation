/**
 * memoryKnowledgeProvider — Team 23
 *
 * Surfaces workflow hints derived from client memory (brand preferences stored
 * in ai_client_memories) and project pipeline context via memoryResolver.
 *
 * This provider is advisory-only: it does NOT write to or mutate client memory.
 */

import type {
  KnowledgeAdapter,
  DesignKnowledgeQuery,
  DesignRecommendation,
  KnowledgeCapability,
} from "../types.js";
import { resolveAgentContext } from "../../memoryResolver.js";

const SOURCE_ID   = "client-memory-system";
const SOURCE_NAME = "Client Memory & Project Context";

const CAPABILITY: KnowledgeCapability = {
  supportedTypes:         ["workflow_hint", "guideline"],
  supportsIndustryFilter: false,
  supportsStyleFilter:    false,
  supportsTenantScope:    true,
  supportsPlatformScope:  false,
  maxResultsPerQuery:     5,
};

export const memoryKnowledgeProvider: KnowledgeAdapter = {
  id:         SOURCE_ID,
  name:       SOURCE_NAME,
  capability: CAPABILITY,

  async isAvailable(): Promise<boolean> {
    return typeof resolveAgentContext === "function";
  },

  async query(q: DesignKnowledgeQuery): Promise<DesignRecommendation[]> {
    // This provider only adds value when a clientId or projectId is present
    if (!q.clientId && !q.projectId) return [];

    const source = {
      providerId:   SOURCE_ID,
      providerName: SOURCE_NAME,
      retrievedAt:  new Date().toISOString(),
    };

    let context;
    try {
      context = await resolveAgentContext({
        agentSlug:           "design-knowledge-adapter",
        stepIndex:           0,
        totalSteps:          1,
        completedSteps:      [],
        currentStep:         "design_knowledge_query",
        projectId:           q.projectId,
        clientId:            q.clientId,
        previousAgentOutput: {},
        previousMetadata:    [],
      });
    } catch {
      // Memory service unavailable — return empty, do not throw
      return [];
    }

    const recs: DesignRecommendation[] = [];
    const scope = q.scope ?? {};

    // ── Client memory preferences ───────────────────────────────────────────
    const mem = context.clientMemory;
    if (Object.keys(mem).length > 0) {
      // Filter out system keys (clientId) before surfacing
      const prefs = Object.entries(mem).filter(
        ([k]) => k !== "clientId",
      );

      for (const [key, value] of prefs) {
        if (typeof value !== "string" && typeof value !== "number") continue;
        recs.push({
          id:           "",
          type:         "workflow_hint",
          title:        `Client Preference — ${key}`,
          body:         `This client has a stored preference: ${key} = ${String(value)}. Consider applying this during design decisions.`,
          confidence:   "medium",
          reason: {
            summary:   `Derived from stored client brand preference for "${key}".`,
            citations: [{
              source,
              referenceId:    `mem:${q.clientId}:${key}`,
              referenceLabel: `Client memory: ${key}`,
            }],
          },
          applicability: [q.clientId ? `Client: ${q.clientId}` : "Current client"],
          limitations:   ["Memory may be stale — verify with the client before applying."],
          hasSource:     true,
          scope,
          isAdvisory:    true,
        });
      }
    }

    // ── Project pipeline context ────────────────────────────────────────────
    if (context.projectMemory.length > 0) {
      const summaries = context.projectMemory
        .slice(0, 3)
        .map((p) => `${p.stepName}: ${p.summary}`)
        .join("; ");

      recs.push({
        id:           "",
        type:         "workflow_hint",
        title:        "Previous Pipeline Context Available",
        body:         `Prior pipeline steps produced relevant outputs: ${summaries}`,
        confidence:   "medium",
        reason: {
          summary:   "Derived from project memory of previous pipeline steps.",
          citations: [{
            source,
            referenceId:    `project:${q.projectId ?? "unknown"}`,
            referenceLabel: "Project pipeline memory",
          }],
        },
        applicability: [q.projectId ? `Project: ${q.projectId}` : "Current project"],
        hasSource:     true,
        scope,
        isAdvisory:    true,
      });
    }

    const limit = q.filter?.limit ?? 5;
    return recs.slice(0, limit);
  },
};
