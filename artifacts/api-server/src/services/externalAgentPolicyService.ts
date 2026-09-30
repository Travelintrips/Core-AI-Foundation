export const EXTERNAL_AGENT_POLICY_VERSION = 1;

export const OPENCLAW_AGENT_CLIENT_ID = "gcp-openclaw-main" as const;
export const OPENHANDS_AGENT_CLIENT_ID = "gcp-openhands-coder" as const;
export const N8N_AGENT_CLIENT_ID = "gcp-n8n-automation" as const;

export const EXTERNAL_AGENT_RULES = {
  [OPENCLAW_AGENT_CLIENT_ID]: {
    source: "openclaw",
    role: "bounded_orchestration_agent",
    capabilities: ["model:chat", "tools:bounded", "task:coordinate"],
    permissions: {
      codingWorkspaceWrite: false,
      gitCommit: false,
      gitPush: false,
      productionDeploy: false,
    },
  },
  [OPENHANDS_AGENT_CLIENT_ID]: {
    source: "openhands",
    role: "coding_executor",
    capabilities: [
      "model:chat",
      "coding:workspace",
      "coding:test",
      "git:branch",
      "git:commit",
      "git:push",
    ],
    permissions: {
      codingWorkspaceWrite: true,
      gitCommit: true,
      gitPush: true,
      productionDeploy: false,
    },
  },
  [N8N_AGENT_CLIENT_ID]: {
    source: "n8n",
    role: "integration_automation_agent",
    capabilities: ["workflow:automation", "webhook:integration"],
    permissions: {
      codingWorkspaceWrite: false,
      gitCommit: false,
      gitPush: false,
      productionDeploy: false,
    },
  },
} as const;

export type ExternalAgentClientId = keyof typeof EXTERNAL_AGENT_RULES;

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
  { clientId: N8N_AGENT_CLIENT_ID, agent: /\bn\s*8\s*n\b|\bn8n\b/i },
];

const DELEGATION_VERB =
  /\b(gunakan|pakai|gunakanlah|jalankan|suruh|minta|delegasikan|delegate|route|rutekan|via|melalui|dengan)\b/i;

export function getExternalAgentRule(clientId: string) {
  return EXTERNAL_AGENT_RULES[clientId as ExternalAgentClientId] ?? null;
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

export function providerForExternalAgent(
  clientId: ExternalAgentClientId,
): "openclaw" | "openhands" | "n8n" {
  return EXTERNAL_AGENT_RULES[clientId].source;
}
