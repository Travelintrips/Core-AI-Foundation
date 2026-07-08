/**
 * memoryResolver.ts — Execution context builder for Creative AI agents.
 *
 * Injects three tiers of memory into each agent step:
 *   1. Client memory   — brand preferences stored in ai_client_memories (by clientId)
 *   2. Project memory  — outputs of previous pipeline steps (this run)
 *   3. System context  — step position, pipeline progress, agent metadata
 *
 * formatContextForPrompt() turns the resolved context into a string
 * that is appended to the agent's system prompt.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StepMetadata {
  stepName:  string;
  agentSlug: string;
  status:    string;
  latencyMs?: number;
  tokenCount?: number;
}

export interface AgentContextInput {
  agentSlug:           string;
  stepIndex:           number;
  totalSteps:          number;
  completedSteps:      string[];
  currentStep:         string;
  projectId?:          string;
  clientId?:           string;
  previousAgentOutput: Record<string, Record<string, unknown>>;
  previousMetadata:    StepMetadata[];
}

export interface ResolvedContext {
  clientMemory:   Record<string, unknown>;
  projectMemory:  { stepName: string; summary: string }[];
  systemContext:  {
    stepIndex:    number;
    totalSteps:   number;
    completedSteps: string[];
    currentStep:  string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function summarizeOutput(stepName: string, output: Record<string, unknown>): string {
  const keys = Object.keys(output);
  if (keys.length === 0) return `${stepName}: no output`;
  const preview = keys
    .slice(0, 3)
    .map((k) => {
      const val = output[k];
      if (typeof val === "string")  return `${k}: "${val.slice(0, 80)}"`;
      if (Array.isArray(val))       return `${k}: [${val.slice(0, 2).join(", ")}]`;
      if (typeof val === "object" && val !== null) return `${k}: {${Object.keys(val).join(", ")}}`;
      return `${k}: ${String(val).slice(0, 40)}`;
    })
    .join("; ");
  return preview;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export async function resolveAgentContext(
  input: AgentContextInput,
): Promise<ResolvedContext> {
  // 1. Client memory — light stub (can be extended to query a DB table later)
  const clientMemory: Record<string, unknown> = input.clientId
    ? { clientId: input.clientId }
    : {};

  // 2. Project memory — summarise each previous step's output
  const projectMemory = Object.entries(input.previousAgentOutput)
    .filter(([, output]) => Object.keys(output).length > 0)
    .map(([stepName, output]) => ({
      stepName,
      summary: summarizeOutput(stepName, output),
    }));

  // 3. System context
  const systemContext = {
    stepIndex:      input.stepIndex,
    totalSteps:     input.totalSteps,
    completedSteps: input.completedSteps,
    currentStep:    input.currentStep,
  };

  return { clientMemory, projectMemory, systemContext };
}

// ── Prompt formatter ──────────────────────────────────────────────────────────

export function formatContextForPrompt(context: ResolvedContext): string {
  const parts: string[] = [];

  if (context.projectMemory.length > 0) {
    parts.push("\n\n---\nPREVIOUS PIPELINE OUTPUTS (use as context):");
    for (const entry of context.projectMemory) {
      parts.push(`[${entry.stepName}]: ${entry.summary}`);
    }
  }

  const { stepIndex, totalSteps, currentStep } = context.systemContext;
  parts.push(
    `\n---\nPIPELINE POSITION: Step ${stepIndex + 1} of ${totalSteps} — ${currentStep}`,
  );

  return parts.join("\n");
}
