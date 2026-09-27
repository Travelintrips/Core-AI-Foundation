import { randomUUID } from "node:crypto";
import {
  createConstrainedModelInvocationAdapter,
} from "./localCodingAiModelAdapterService.js";
import {
  createScheduledOllamaProviderAdapter,
} from "./localCodingOllamaWorkerProviderService.js";
import {
  LocalCodingPowerShellError,
  parseAllowlistedPowerShellCommand,
} from "./localCodingPowerShellExecutorService.js";
import {
  enqueueRemotePowerShellExecution,
  waitForRemotePowerShellExecution,
} from "./remoteOllamaWorkerService.js";

const DEFAULT_MODEL = "qwen2.5-coder:7b";

const COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commands", "reason"],
  properties: {
    commands: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
    reason: { type: "string", minLength: 1, maxLength: 1_000 },
  },
} as const;

const ALLOWLIST_DESCRIPTION = [
  "Get-Location",
  "Get-ChildItem",
  "Get-ChildItem -Name",
  "git status --short",
  "git diff --check",
  "git diff --name-only",
  "git rev-parse HEAD",
  "node --version",
  "pnpm --version",
  "pnpm test",
  "pnpm typecheck",
  "pnpm lint",
  "pnpm build",
  "pnpm --filter <package> test",
  "pnpm --filter <package> typecheck",
  "pnpm --filter <package> lint",
  "pnpm --filter <package> build",
  "pnpm --filter <package> run test",
  "pnpm --filter <package> run typecheck",
  "pnpm --filter <package> run lint",
  "pnpm --filter <package> run build",
  "npm run test",
  "npm run typecheck",
  "npm run lint",
  "npm run build",
].join("\n");

function parsePlan(value: unknown): { commands: string[]; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalCodingPowerShellError("Ollama returned an invalid PowerShell plan.", "INVALID_COMMAND");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.commands) || typeof record.reason !== "string") {
    throw new LocalCodingPowerShellError("Ollama returned a malformed PowerShell plan.", "INVALID_COMMAND");
  }
  const commands = record.commands as unknown[];
  if (commands.length < 1 || commands.length > 6 || commands.some((x) => typeof x !== "string")) {
    throw new LocalCodingPowerShellError("Ollama returned a malformed PowerShell plan.", "INVALID_COMMAND");
  }
  for (const command of commands as string[]) {
    if (!parseAllowlistedPowerShellCommand(command)) {
      throw new LocalCodingPowerShellError(
        "Ollama proposed a command outside the trusted allowlist: " + command.slice(0, 180),
        "INVALID_COMMAND",
      );
    }
  }
  return { commands: commands as string[], reason: record.reason.slice(0, 1_000) };
}

export async function runRemoteTrustedPowerShellTask(input: {
  instruction: string;
  requestedBy?: string;
  modelId?: string;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  const instruction = input.instruction.trim();
  if (!instruction || instruction.length > 4_000 || /\0/.test(instruction)) {
    throw new LocalCodingPowerShellError("Trusted PowerShell instruction is invalid.", "INVALID_COMMAND");
  }

  const modelId = (input.modelId || process.env["OLLAMA_WORKER_MODEL"] || DEFAULT_MODEL).trim();
  const requestedBy = (input.requestedBy || "production-control-plane").trim();
  const provider = createScheduledOllamaProviderAdapter({ modelId });
  const adapter = createConstrainedModelInvocationAdapter(provider);

  const planResponse = await adapter.invoke({
    requestId: "remote-powershell-plan-" + randomUUID(),
    target: { provider: "ollama", model: modelId },
    input: JSON.stringify({
      version: 1,
      system: [
        "You are a command planner for a trusted Windows coding worker.",
        "Return only strict JSON.",
        "Use the minimum commands necessary.",
        "Every command MUST match one of these allowlisted forms:",
        ALLOWLIST_DESCRIPTION,
      ].join("\n"),
      user: instruction,
    }),
    responseFormat: {
      type: "structured",
      schemaName: "remote_trusted_powershell_plan",
      jsonSchema: COMMAND_SCHEMA as unknown as Record<string, unknown>,
    },
    maxOutputTokens: 1_024,
    timeoutMs: Math.max(15_000, Math.min(300_000, input.timeoutMs ?? 180_000)),
  });

  if (planResponse.output.type !== "structured") {
    throw new LocalCodingPowerShellError("Ollama did not return a structured PowerShell plan.", "INVALID_COMMAND");
  }

  const plan = parsePlan(planResponse.output.value);
  const job = await enqueueRemotePowerShellExecution({
    commands: plan.commands,
    requestedBy,
    modelId,
    reason: plan.reason,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15_000, Math.min(300_000, input.timeoutMs ?? 180_000)));
  timer.unref?.();
  try {
    const execution = await waitForRemotePowerShellExecution(job.id, controller.signal);
    return {
      instruction,
      modelId,
      reason: plan.reason,
      plannedCommands: plan.commands,
      jobId: job.id,
      jobCode: job.jobCode,
      execution,
    };
  } finally {
    clearTimeout(timer);
  }
}
