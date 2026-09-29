import { eq } from "drizzle-orm";
import { aiCodingBridgePresenceTable, db } from "@workspace/db";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";
import { renewCodingBridgePresence } from "./localCodingControlBridgeService.js";

export const EXTERNAL_AGENT_POLICY_VERSION = 1;
export const EXTERNAL_AGENT_LEASE_SECONDS = 90;

export const EXTERNAL_AGENT_RULES = {
  "gcp-openclaw-main": {
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
  "gcp-openhands-coder": {
    source: "openhands",
    role: "coding_executor",
    capabilities: ["model:chat", "coding:workspace", "coding:test", "git:branch", "git:commit", "git:push"],
    permissions: {
      codingWorkspaceWrite: true,
      gitCommit: true,
      gitPush: true,
      productionDeploy: false,
    },
  },
  "gcp-n8n-automation": {
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
export type ExternalAgentHealth = "healthy" | "degraded";

export class ExternalAgentRegistryError extends Error {
  constructor(
    public readonly code: "UNKNOWN_AGENT" | "INVALID_DETAILS",
    message: string,
  ) {
    super(message);
    this.name = "ExternalAgentRegistryError";
  }
}

export function getExternalAgentRule(clientId: string) {
  return EXTERNAL_AGENT_RULES[clientId as ExternalAgentClientId] ?? null;
}

function safeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {};
  const encoded = JSON.stringify(details);
  if (encoded.length > 4096) {
    throw new ExternalAgentRegistryError(
      "INVALID_DETAILS",
      "External agent heartbeat details exceed 4096 bytes.",
    );
  }
  return details;
}

export async function heartbeatExternalAgent(input: {
  clientId: string;
  health: ExternalAgentHealth;
  version?: string | null;
  details?: Record<string, unknown>;
}) {
  const rule = getExternalAgentRule(input.clientId);
  if (!rule) {
    throw new ExternalAgentRegistryError(
      "UNKNOWN_AGENT",
      "External agent client ID is not registered in AI Core policy.",
    );
  }

  const metadata = {
    authority: "ai-core",
    policyVersion: EXTERNAL_AGENT_POLICY_VERSION,
    role: rule.role,
    capabilities: [...rule.capabilities],
    permissions: { ...rule.permissions },
    reportedHealth: input.health,
    version: input.version?.trim() || null,
    details: safeDetails(input.details),
  };

  const row = await renewCodingBridgePresence({
    clientId: input.clientId,
    source: rule.source,
    leaseSeconds: EXTERNAL_AGENT_LEASE_SECONDS,
    metadata,
  });

  return {
    clientId: row.clientId,
    source: row.source,
    leaseExpiresAt: row.leaseExpiresAt,
    lastSeenAt: row.lastSeenAt,
    policy: metadata,
    eligible: input.health === "healthy",
  };
}

export async function getExternalAgentRegistrySnapshot() {
  await ensureCodingControlBridgeTables();
  const now = Date.now();

  return Promise.all(
    Object.entries(EXTERNAL_AGENT_RULES).map(async ([clientId, rule]) => {
      const [row] = await db
        .select()
        .from(aiCodingBridgePresenceTable)
        .where(eq(aiCodingBridgePresenceTable.clientId, clientId))
        .limit(1);

      const metadata = (row?.metadataJson ?? {}) as Record<string, unknown>;
      const presenceState =
        row && row.leaseExpiresAt.getTime() > now ? "ACTIVE" : "UNAVAILABLE";
      const reportedHealth =
        metadata["reportedHealth"] === "healthy" ||
        metadata["reportedHealth"] === "degraded"
          ? metadata["reportedHealth"]
          : "unknown";
      const eligible = presenceState === "ACTIVE" && reportedHealth === "healthy";

      return {
        clientId,
        source: rule.source,
        role: rule.role,
        capabilities: [...rule.capabilities],
        permissions: { ...rule.permissions },
        presenceState,
        reportedHealth,
        eligible,
        lastSeenAt: row?.lastSeenAt ?? null,
        leaseExpiresAt: row?.leaseExpiresAt ?? null,
        version: typeof metadata["version"] === "string" ? metadata["version"] : null,
      };
    }),
  );
}
