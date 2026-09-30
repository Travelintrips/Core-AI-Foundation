import { randomUUID } from "node:crypto";
import { getExternalAgentRegistrySnapshot } from "./externalAgentRegistryService.js";
import {
  EXTERNAL_AGENT_POLICY_VERSION,
  getExternalAgentRule,
  requiredCapabilityForExternalAgent,
  type ExternalAgentClientId,
} from "./externalAgentPolicyService.js";
import {
  getCodingBridgeCommandExecutionState,
  submitCodingBridgeCommand,
} from "./localCodingControlBridgeService.js";

export {
  detectExplicitExternalAgentClientId,
  N8N_AGENT_CLIENT_ID,
  OPENCLAW_AGENT_CLIENT_ID,
  OPENHANDS_AGENT_CLIENT_ID,
  providerForExternalAgent,
  requiredCapabilityForExternalAgent,
} from "./externalAgentPolicyService.js";
export type { ExternalAgentClientId } from "./externalAgentPolicyService.js";

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

export async function dispatchExternalAgentWork(input: {
  clientId: ExternalAgentClientId;
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

  const requiredCapability = requiredCapabilityForExternalAgent(input.clientId);
  if (!rule.capabilities.some((capability) => capability === requiredCapability)) {
    throw new ExternalAgentDispatchError(
      "CAPABILITY_DENIED",
      `External agent is not authorized for required capability ${requiredCapability}.`,
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
      requiredCapability,
      permissions: { ...rule.permissions },
    },
    metadata: {
      requestedAt: new Date().toISOString(),
      executionBoundary: "role-scoped",
      requiredCapability,
      criticalActionsRequireAiCoreApproval: true,
    },
  });

  return {
    clientId: input.clientId,
    requiredCapability,
    command: submitted.command,
    created: submitted.created,
  };
}

export async function getExternalAgentWorkState(commandId: string) {
  return getCodingBridgeCommandExecutionState(commandId);
}
