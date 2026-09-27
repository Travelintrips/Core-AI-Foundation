import { randomUUID } from "node:crypto";
import {
  executeTrustedOllamaPowerShellCommands,
  LocalCodingPowerShellError,
  parseAllowlistedPowerShellCommand,
  type PreparedPowerShellExecution,
  type PowerShellExecutor,
} from "./localCodingPowerShellExecutorService.js";
import {
  readOllamaLocalConfig,
} from "./ollamaLocalService.js";

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

function parseStructuredJsonText(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // continue
    }
  }

  throw new LocalCodingPowerShellError(
    "Ollama returned malformed structured JSON.",
    "INVALID_COMMAND",
  );
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

export interface DirectTrustedPowerShellTaskResult {
  instruction: string;
  modelId: string;
  reason: string;
  plannedCommands: string[];
  execution: PreparedPowerShellExecution;
}

export async function runDirectLocalOllamaPowerShellTask(input: {
  instruction: string;
  requestedBy?: string;
  modelId?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  executor?: PowerShellExecutor;
}): Promise<DirectTrustedPowerShellTaskResult> {
  const env = input.env ?? process.env;
  const instruction = input.instruction.trim();

  if (!instruction || instruction.length > MAX_INSTRUCTION_CHARS || /\0/.test(instruction)) {
    throw new LocalCodingPowerShellError(
      "Trusted PowerShell task instruction is empty or exceeds the bounded size.",
      "INVALID_COMMAND",
    );
  }

  const config = readOllamaLocalConfig({
    ...env,
    OLLAMA_ENABLED: "true",
    ...(input.modelId ? { OLLAMA_MODEL: input.modelId } : {}),
  });
  const modelId = input.modelId?.trim() || config.model;
  const requestedBy = (input.requestedBy || "direct-local-bootstrap").trim();
  const controller = new AbortController();
  const timeoutMs = Math.max(
    15_000,
    Math.min(
      300_000,
      Number.isFinite(input.timeoutMs)
        ? Math.floor(input.timeoutMs as number)
        : DEFAULT_TIMEOUT_MS,
    ),
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  let response: Response;
  try {
    response = await fetch(config.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "system",
            content: [
              "You are a command planner for a trusted local coding worker.",
              "You do NOT execute commands yourself.",
              "Return exactly one JSON object and no Markdown.",
              "Choose the minimum commands needed for the user's instruction.",
              "Every command MUST exactly fit one of the allowed command forms below.",
              "Never propose network access, file deletion, arbitrary file reads, git commit/push, shell chaining, redirection, or nested shells.",
              "",
              "Allowed commands:",
              ALLOWLIST_DESCRIPTION,
              "",
              "The JSON must satisfy this schema:",
              JSON.stringify(COMMAND_SCHEMA),
            ].join("\n"),
          },
          {
            role: "user",
            content: instruction,
          },
        ],
        stream: false,
        temperature: 0,
        max_tokens: 1_024,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      "Direct local Ollama is unavailable at " +
        config.baseUrl +
        ": " +
        (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      "Direct local Ollama request failed with HTTP " + response.status + ".",
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new LocalCodingPowerShellError(
      "Ollama returned a non-text command plan.",
      "INVALID_COMMAND",
    );
  }

  const plan = parsePlan(parseStructuredJsonText(text));
  const execution = await executeTrustedOllamaPowerShellCommands({
    requestedBy,
    modelId,
    commands: plan.commands,
    timeoutMs,
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
