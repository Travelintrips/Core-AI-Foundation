/**
 * memoryResolver — assembles the full AgentExecutionContext before each agent step.
 *
 * Context shape injected into every agent:
 *   previousAgentOutput  — outputs from all prior steps in this run
 *   previousMetadata     — model/token/latency metadata from prior steps
 *   projectMemory        — persistent notes about this project
 *   clientMemory         — long-term brand preferences for this client
 *   workflowState        — step position metadata
 */

import {
  getGlobalMemory,
  getProjectMemory,
  getAgentMemory,
  getClientMemory,
  clientMemoryToRecord,
  type MemoryEntry,
  type ClientMemoryEntry,
} from "./memoryService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StepMetadata {
  stepName: string;
  model?: string | null;
  provider?: string | null;
  tokens?: number;
  latencyMs?: number | null;
}

export interface AgentExecutionContext {
  previousAgentOutput: Record<string, Record<string, unknown>>;
  previousMetadata: StepMetadata[];
  projectMemory: MemoryEntry[];
  clientMemory: Record<string, string>;
  globalMemory: MemoryEntry[];
  agentMemory: MemoryEntry[];
  workflowState: {
    stepIndex: number;
    totalSteps: number;
    completedSteps: string[];
    currentStep: string;
  };
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export interface ResolverInput {
  agentSlug: string;
  stepIndex: number;
  totalSteps: number;
  completedSteps: string[];
  currentStep: string;
  projectId: string;
  clientId: string;   // brand name used as client identifier
  previousAgentOutput: Record<string, Record<string, unknown>>;
  previousMetadata: StepMetadata[];
}

export async function resolveAgentContext(input: ResolverInput): Promise<AgentExecutionContext> {
  // Fetch all memory tiers in parallel
  const [projectMemory, clientMemoryEntries, globalMemory, agentMemory] = await Promise.all([
    getProjectMemory(input.projectId).catch(() => [] as MemoryEntry[]),
    getClientMemory(input.clientId).catch(() => [] as ClientMemoryEntry[]),
    getGlobalMemory().catch(() => [] as MemoryEntry[]),
    getAgentMemory(input.agentSlug).catch(() => [] as MemoryEntry[]),
  ]);

  return {
    previousAgentOutput: input.previousAgentOutput,
    previousMetadata: input.previousMetadata,
    projectMemory,
    clientMemory: clientMemoryToRecord(clientMemoryEntries),
    globalMemory,
    agentMemory,
    workflowState: {
      stepIndex: input.stepIndex,
      totalSteps: input.totalSteps,
      completedSteps: input.completedSteps,
      currentStep: input.currentStep,
    },
  };
}

/**
 * Serialises context to a concise string block for injection into system prompts.
 * Only includes non-empty sections to keep prompt tokens minimal.
 */
export function formatContextForPrompt(ctx: AgentExecutionContext): string {
  const sections: string[] = [];

  if (Object.keys(ctx.clientMemory).length > 0) {
    sections.push(
      "=== CLIENT MEMORY (long-term brand preferences) ===\n" +
        Object.entries(ctx.clientMemory)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n"),
    );
  }

  if (ctx.projectMemory.length > 0) {
    sections.push(
      "=== PROJECT MEMORY ===\n" +
        ctx.projectMemory
          .filter((m) => m.key)
          .map((m) => `${m.key}: ${m.value}`)
          .join("\n"),
    );
  }

  if (ctx.agentMemory.length > 0) {
    sections.push(
      "=== AGENT MEMORY (your past learnings) ===\n" +
        ctx.agentMemory
          .slice(0, 5) // cap to avoid token explosion
          .map((m) => `${m.key || "note"}: ${m.value}`)
          .join("\n"),
    );
  }

  return sections.length > 0 ? "\n\n" + sections.join("\n\n") : "";
}
