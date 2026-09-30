import { randomUUID } from "node:crypto";
import {
  EXTERNAL_AGENT_POLICY_VERSION,
  getExternalAgentRegistrySnapshot,
  getExternalAgentRule,
} from "./externalAgentRegistryService.js";
import {
  getCodingBridgeCommandExecutionState,
  submitCodingBridgeCommand,
} from "./localCodingControlBridgeService.js";

export const OPENCLAW_AGENT_CLIENT_ID = "gcp-openclaw-main" as const;

export class ExternalAgentDispatchError extends Error {
  constructor(
    public readonly code:
      | "UNKNOWN_AGENT"
      | "AGENT_UNAVAILABLE"
      | "CAPABILITY_DENIED",
    message: string,
  ) {
    super(message);
    this.name = "ExternalAgentDispatchError";
  }
}

export function isExplicitOpenClawDelegation(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text || !/\bopen\s*claw\b|\bopenclaw\b/i.test(text)) return false;

  return /\b(gunakan|pakai|gunakanlah|jalankan|suruh|minta|delegasikan|delegate|route|rutekan|via|melalui|dengan)\b/i.test(
    text,
  );
}

export async function dispatchExternalAgentWork(input: {
  clientId: string;
  instruction: string;
  taskId?: string | null;
  source?: string;
}) {
  const rule = getExternalAgentRule(input.clientId);
  if (!rule) {
    throw new ExternalAgentDispatchError(
      "UNKNOWN_AGENT",
      "External agent is not registered in AI Core policy.",
    );
  }

  if (!rule.capabilities.some((capability) => capability === "tools:bounded")) {
    throw new ExternalAgentDispatchError(
      "CAPABILITY_DENIED",
      "External agent is not authorized for bounded tool execution.",
    );
  }

  const registry = await getExternalAgentRegistrySnapshot();
  const agent = registry.find((item) => item.clientId === input.clientId);
  if (!agent?.eligible) {
    throw new ExternalAgentDispatchError(
      "AGENT_UNAVAILABLE",
      "External agent is not healthy and active in the AI Core registry.",
    );
  }

  const externalCommandId = `ai-core-agent-${randomUUID()}`;
  const submitted = await submitCodingBridgeCommand({
    externalCommandId,
    instruction: input.instruction,
    taskId: input.taskId ?? null,
    source: input.source ?? "ai-core",
    commandType: "EXTERNAL_AGENT_WORK",
    assignedClientId: input.clientId,
    authority: {
      authority: "ai-core",
      policyVersion: EXTERNAL_AGENT_POLICY_VERSION,
      clientId: input.clientId,
      role: rule.role,
      capabilities: [...rule.capabilities],
      permissions: { ...rule.permissions },
    },
    metadata: {
      requestedAt: new Date().toISOString(),
      executionBoundary: "bounded",
      criticalActionsRequireAiCoreApproval: true,
    },
  });

  return {
    clientId: input.clientId,
    command: submitted.command,
    created: submitted.created,
  };
}

export async function getExternalAgentWorkState(commandId: string) {
  return getCodingBridgeCommandExecutionState(commandId);
}
