import { randomUUID } from "node:crypto";
import {
  createConstrainedModelInvocationAdapter,
} from "./localCodingAiModelAdapterService.js";
import {
  createScheduledOllamaProviderAdapter,
} from "./localCodingOllamaWorkerProviderService.js";
import {
  executeTrustedOllamaPowerShellCommands,
  LocalCodingPowerShellError,
  parseAllowlistedPowerShellCommand,
  type PowerShellExecutor,
  type PreparedPowerShellExecution,
} from "./localCodingPowerShellExecutorService.js";
import { logAudit } from "./aiAuditService.js";

const DEFAULT_MODEL = "qwen2.5-coder:7b";
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_INSTRUCTION_CHARS = 4_000;

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
  "pnpm ci:test",
  "pnpm ci:verify",
  "pnpm ci:build",
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

export interface TrustedPowerShellTaskResult {
  instruction: string;
  modelId: string;
  reason: string;
  plannedCommands: string[];
  execution: PreparedPowerShellExecution;
}

function parsePlan(value: unknown): { commands: string[]; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalCodingPowerShellError(
      "Ollama returned an invalid PowerShell plan.",
      "INVALID_COMMAND",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["commands", "reason"].includes(key)) ||
    !Array.isArray(record.commands) ||
    record.commands.length < 1 ||
    record.commands.length > 6 ||
    record.commands.some((command) => typeof command !== "string") ||
    typeof record.reason !== "string"
  ) {
    throw new LocalCodingPowerShellError(
      "Ollama returned a malformed PowerShell plan.",
      "INVALID_COMMAND",
    );
  }

  const commands = record.commands as string[];
  for (const command of commands) {
    if (!parseAllowlistedPowerShellCommand(command)) {
      throw new LocalCodingPowerShellError(
        "Ollama proposed a command outside the trusted allowlist: " +
          command.slice(0, 180),
        "INVALID_COMMAND",
      );
    }
  }

  return {
    commands,
    reason: record.reason.slice(0, 1_000),
  };
}

export async function runTrustedOllamaPowerShellTask(input: {
  instruction: string;
  taskId?: string | null;
  requestedBy?: string;
  modelId?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  executor?: PowerShellExecutor;
}): Promise<TrustedPowerShellTaskResult> {
  const env = input.env ?? process.env;
  const instruction = input.instruction.trim();
  if (!instruction || instruction.length > MAX_INSTRUCTION_CHARS || /\0/.test(instruction)) {
    throw new LocalCodingPowerShellError(
      "Trusted PowerShell task instruction is empty or exceeds the bounded size.",
      "INVALID_COMMAND",
    );
  }

  const modelId = (
    input.modelId ||
    env["OLLAMA_WORKER_MODEL"] ||
    env["OLLAMA_MODEL"] ||
    DEFAULT_MODEL
  ).trim();
  const requestedBy = (input.requestedBy || "trusted-local-orchestrator").trim();

  const provider = createScheduledOllamaProviderAdapter({ modelId });
  const adapter = createConstrainedModelInvocationAdapter(provider);

  const response = await adapter.invoke({
    requestId: "powershell-" + randomUUID(),
    target: { provider: "ollama", model: modelId },
    input: JSON.stringify({
      version: 1,
      system: [
        "You are a command planner for a trusted local coding worker.",
        "You do NOT execute commands yourself.",
        "Return only strict JSON matching the requested schema.",
        "Choose the minimum commands needed for the user's instruction.",
        "Every command MUST exactly fit one of the allowed command forms below.",
        "Never propose network access, file deletion, arbitrary file reads, git commit/push, shell chaining, redirection, or nested shells.",
        "",
        "Allowed commands:",
        ALLOWLIST_DESCRIPTION,
      ].join("\n"),
      user: instruction,
    }),
    responseFormat: {
      type: "structured",
      schemaName: "trusted_powershell_plan",
      jsonSchema: COMMAND_SCHEMA as unknown as Record<string, unknown>,
    },
    maxOutputTokens: 1_024,
    timeoutMs: Math.max(
      15_000,
      Math.min(
        300_000,
        Number.isFinite(input.timeoutMs)
          ? Math.floor(input.timeoutMs as number)
          : DEFAULT_TIMEOUT_MS,
      ),
    ),
  });

  if (response.output.type !== "structured") {
    throw new LocalCodingPowerShellError(
      "Ollama did not return a structured PowerShell plan.",
      "INVALID_COMMAND",
    );
  }

  const plan = parsePlan(response.output.value);

  await logAudit(
    "ollama-worker",
    "trusted_powershell_plan_created",
    input.taskId ?? response.metadata.requestId,
    "coding_powershell_execution",
    "success",
    {
      modelId,
      requestedBy,
      commands: plan.commands,
      reason: plan.reason,
    },
  ).catch(() => undefined);

  const execution = await executeTrustedOllamaPowerShellCommands({
    taskId: input.taskId,
    requestedBy,
    modelId,
    commands: plan.commands,
    timeoutMs: input.timeoutMs,
    env,
    executor: input.executor,
  });

  return {
    instruction,
    modelId,
    reason: plan.reason,
    plannedCommands: plan.commands,
    execution,
  };
}
