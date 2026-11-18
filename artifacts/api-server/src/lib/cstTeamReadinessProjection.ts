/** DEV-only, least-information projection of the existing AI Core agent registry.
 * Presence is not authority to dispatch work and is not execution evidence.
 */
export const CST_TEAM_MONITOR_CLIENTS = [
  "openclaw-vps-main",
  "openclaw-pc-worker-dev",
  "openclaw-travelintrips-tools-dev",
] as const;

type CoreAgentPresence = {
  clientId: string;
  eligible?: boolean;
  presenceState?: string;
  reportedHealth?: string;
  lastSeenAt?: Date | string | null;
  leaseExpiresAt?: Date | string | null;
};

export function isCstTeamDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_ENV === "development" && env.NODE_ENV === "development";
}

export function projectCstTeamReadiness(
  snapshot: readonly CoreAgentPresence[],
  checkedAt: Date = new Date(),
) {
  return {
    schemaVersion: 1,
    source: "ai-core-agent-registry",
    mode: "PRESENCE_ONLY_NOT_EXECUTION_PROOF",
    checkedAt: checkedAt.toISOString(),
    workers: CST_TEAM_MONITOR_CLIENTS.map(clientId => {
      const agent = snapshot.find(row => row.clientId === clientId);
      const eligible = agent?.eligible === true
        && agent.presenceState === "ACTIVE"
        && agent.reportedHealth === "healthy";
      return {
        clientId,
        eligible,
        presenceState: agent?.presenceState === "ACTIVE" ? "ACTIVE" : "UNAVAILABLE",
        reportedHealth: agent?.reportedHealth === "healthy" ? "healthy"
          : agent?.reportedHealth === "degraded" ? "degraded" : "unknown",
        lastSeenAt: agent?.lastSeenAt ?? null,
        leaseExpiresAt: agent?.leaseExpiresAt ?? null,
      };
    }),
  };
}
