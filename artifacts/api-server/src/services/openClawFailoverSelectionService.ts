export const OPENCLAW_VPS_CLIENT_ID = "openclaw-vps-main" as const;
export const OPENCLAW_PC_CLIENT_ID = "openclaw-pc-worker" as const;
export const OPENCLAW_PC2_CLIENT_ID = "openclaw-pc-worker-2" as const;
export const OPENCLAW_PC3_CLIENT_ID = "openclaw-pc-worker-3" as const;
export const OPENCLAW_LEGACY_CLIENT_ID = "gcp-openclaw-main" as const;
export const OPENCLAW_PC_CLIENT_IDS = [
  OPENCLAW_PC_CLIENT_ID, OPENCLAW_PC2_CLIENT_ID, OPENCLAW_PC3_CLIENT_ID,
] as const;

type ExecutorPresence = {
  clientId: string;
  eligible: boolean;
  availableSlots?: number;
  activeJobs?: number;
};

/** Single-active-PC routing. Busy is not offline: queue new tasks on the elected PC.
 * Already claimed commands are never replayed here; their recovery requires a separate protocol.
 */
export function selectOpenClawExecutor(
  presences: readonly ExecutorPresence[],
  options: { preferServer?: boolean; activePcId?: string } = {},
): string | null {
  const healthy = new Set(presences.filter((p) => p.eligible).map((p) => p.clientId));
  if (options.preferServer) {
    return [OPENCLAW_VPS_CLIENT_ID, OPENCLAW_LEGACY_CLIENT_ID]
      .find((id) => healthy.has(id)) ?? null;
  }
  // Only one PC receives normal work. Capacity exhaustion is not a failover signal.
  // Retain the previous leader if it is still healthy, even after PC1 reconnects.
  if (options.activePcId && (OPENCLAW_PC_CLIENT_IDS as readonly string[]).includes(options.activePcId) && healthy.has(options.activePcId)) {
    return options.activePcId;
  }
  return OPENCLAW_PC_CLIENT_IDS.find((id) => healthy.has(id)) ?? null;
}
