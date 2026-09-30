/**
 * Execution context builder for Creative AI agents.
 *
 * Memory tiers:
 * 1. Client memory — persistent approved/inferred client preferences.
 * 2. Project memory — outputs from previous pipeline steps.
 * 3. System context — current pipeline position.
 */
import { desc, eq } from "drizzle-orm";
import { aiClientMemoryTable, db } from "@workspace/db";

export interface StepMetadata {
  stepName: string;
  agentSlug: string;
  status: string;
  latencyMs?: number;
  tokenCount?: number;
}

export interface AgentContextInput {
  agentSlug: string;
  stepIndex: number;
  totalSteps: number;
  completedSteps: string[];
  currentStep: string;
  projectId?: string;
  clientId?: string;
  previousAgentOutput: Record<string, Record<string, unknown>>;
  previousMetadata: StepMetadata[];
}

export interface ResolvedContext {
  clientMemory: Record<string, unknown>;
  projectMemory: { stepName: string; summary: string }[];
  systemContext: {
    stepIndex: number;
    totalSteps: number;
    completedSteps: string[];
    currentStep: string;
  };
}

function summarizeOutput(stepName: string, output: Record<string, unknown>): string {
  const keys = Object.keys(output);
  if (keys.length === 0) return `${stepName}: no output`;
  return keys
    .slice(0, 3)
    .map((key) => {
      const value = output[key];
      if (typeof value === "string") return `${key}: "${value.slice(0, 80)}"`;
      if (Array.isArray(value)) return `${key}: [${value.slice(0, 2).join(", ")}]`;
      if (typeof value === "object" && value !== null) return `${key}: {${Object.keys(value).join(", ")}}`;
      return `${key}: ${String(value).slice(0, 40)}`;
    })
    .join("; ");
}

async function loadClientMemory(clientId?: string): Promise<Record<string, unknown>> {
  if (!clientId) return {};
  const rows = await db
    .select()
    .from(aiClientMemoryTable)
    .where(eq(aiClientMemoryTable.clientId, clientId))
    .orderBy(desc(aiClientMemoryTable.updatedAt))
    .limit(100);

  return rows.reduce<Record<string, unknown>>((memory, row) => {
    let value: unknown = row.value;
    if (row.valueType === "json" || row.valueType === "array") {
      try { value = JSON.parse(row.value); } catch { value = row.value; }
    } else if (row.valueType === "number") {
      const number = Number(row.value);
      value = Number.isFinite(number) ? number : row.value;
    }
    memory[row.key] = value;
    return memory;
  }, {});
}

export async function resolveAgentContext(input: AgentContextInput): Promise<ResolvedContext> {
  const clientMemory = await loadClientMemory(input.clientId);

  const projectMemory = Object.entries(input.previousAgentOutput)
    .filter(([, output]) => Object.keys(output).length > 0)
    .map(([stepName, output]) => ({ stepName, summary: summarizeOutput(stepName, output) }));

  const systemContext = {
    stepIndex: input.stepIndex,
    totalSteps: input.totalSteps,
    completedSteps: input.completedSteps,
    currentStep: input.currentStep,
  };

  return { clientMemory, projectMemory, systemContext };
}

export function formatContextForPrompt(context: ResolvedContext): string {
  const parts: string[] = [];

  const clientEntries = Object.entries(context.clientMemory);
  if (clientEntries.length > 0) {
    parts.push("\n\n---\nCLIENT MEMORY (use when relevant; never overrides safety/approval policy):");
    for (const [key, value] of clientEntries.slice(0, 50)) {
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      parts.push(`[${key}]: ${rendered.slice(0, 500)}`);
    }
  }

  if (context.projectMemory.length > 0) {
    parts.push("\n\n---\nPREVIOUS PIPELINE OUTPUTS (use as context):");
    for (const entry of context.projectMemory) parts.push(`[${entry.stepName}]: ${entry.summary}`);
  }

  const { stepIndex, totalSteps, currentStep } = context.systemContext;
  parts.push(`\n---\nPIPELINE POSITION: Step ${stepIndex + 1} of ${totalSteps} — ${currentStep}`);
  return parts.join("\n");
}
