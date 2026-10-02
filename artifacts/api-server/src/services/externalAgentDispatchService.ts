import { randomUUID } from "node:crypto";
import {
  EXTERNAL_AGENT_POLICY_VERSION,
  getExternalAgentRegistrySnapshot,
  getExternalAgentRule,
  type ExternalAgentClientId,
} from "./externalAgentRegistryService.js";
import {
  getCodingBridgeCommandExecutionState,
  submitCodingBridgeCommand,
} from "./localCodingControlBridgeService.js";

export const OPENCLAW_AGENT_CLIENT_ID = "gcp-openclaw-main" as const;
export const OPENHANDS_AGENT_CLIENT_ID = "gcp-openhands-coder" as const;
export const N8N_AGENT_CLIENT_ID = "gcp-n8n-automation" as const;

const REQUIRED_CAPABILITY: Record<ExternalAgentClientId, string> = {
  [OPENCLAW_AGENT_CLIENT_ID]: "tools:bounded",
  [OPENHANDS_AGENT_CLIENT_ID]: "coding:workspace",
  [N8N_AGENT_CLIENT_ID]: "workflow:automation",
};

const EXPLICIT_AGENT_PATTERNS: Array<{
  clientId: ExternalAgentClientId;
  agent: RegExp;
}> = [
  { clientId: OPENCLAW_AGENT_CLIENT_ID, agent: /\bopen\s*claw\b|\bopenclaw\b/i },
  { clientId: OPENHANDS_AGENT_CLIENT_ID, agent: /\bopen\s*hands\b|\bopenhands\b/i },
  { clientId: N8N_AGENT_CLIENT_ID, agent: /\bn8n\b/i },
];

const DELEGATION_VERB =
  /\b(gunakan|pakai|gunakanlah|jalankan|suruh|minta|delegasikan|delegate|route|rutekan|via|melalui|dengan)\b/i;

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

export function detectExplicitExternalAgentClientId(
  message: string,
): ExternalAgentClientId | null {
  const text = message.trim();
  if (!text || !DELEGATION_VERB.test(text)) return null;

  for (const candidate of EXPLICIT_AGENT_PATTERNS) {
    if (candidate.agent.test(text)) return candidate.clientId;
  }
  return null;
}

export function requiredCapabilityForExternalAgent(
  clientId: ExternalAgentClientId,
): string {
  return REQUIRED_CAPABILITY[clientId];
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

  const requiredCapability = requiredCapabilityForExternalAgent(
    input.clientId as ExternalAgentClientId,
  );
  if (!rule.capabilities.some((capability) => capability === requiredCapability)) {
    throw new ExternalAgentDispatchError(
      "CAPABILITY_DENIED",
      `External agent is not authorized for required capability ${requiredCapability}.`,
    );
  }

  const registry = await getExternalAgentRegistrySnapshot();
  const agent = registry.find((item) => item.clientId === input.clientId);
  const coldStart = !agent?.eligible;

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
      executionBoundary: "role-scoped",
      requiredCapability,
      coldStart,
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

