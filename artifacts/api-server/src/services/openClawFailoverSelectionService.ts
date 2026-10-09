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
  /** Heartbeat-reported capacity. Missing values default to one slot. */
  availableSlots?: number;
  /** Heartbeat-reported running jobs, used for load-aware tie breaking. */
  activeJobs?: number;
};

/** Choose only a healthy node with spare capacity. Never move in-flight commands here. */
export function selectOpenClawExecutor(
  presences: readonly ExecutorPresence[],
  options: { preferServer?: boolean } = {},
): string | null {
  const eligible = presences.filter((p) =>
    p.eligible && (p.availableSlots === undefined || p.availableSlots > 0)
  );
  if (options.preferServer) {
    // Server-only operations cannot be sent to a Windows workstation.
    return [OPENCLAW_VPS_CLIENT_ID, OPENCLAW_LEGACY_CLIENT_ID]
      .find((id) => eligible.some((p) => p.clientId === id)) ?? null;
  }
  // A healthy PC always outranks the VPS, even when it has higher load.
  const pc = eligible.filter((p) =>
    (OPENCLAW_PC_CLIENT_IDS as readonly string[]).includes(p.clientId)
  ).sort((a, b) =>
    (a.activeJobs ?? 0) - (b.activeJobs ?? 0) ||
    (b.availableSlots ?? 1) - (a.availableSlots ?? 1) ||
    OPENCLAW_PC_CLIENT_IDS.indexOf(a.clientId as typeof OPENCLAW_PC_CLIENT_IDS[number]) -
      OPENCLAW_PC_CLIENT_IDS.indexOf(b.clientId as typeof OPENCLAW_PC_CLIENT_IDS[number])
  );
  if (pc.length) return pc[0].clientId;
  // Do not silently fall back to GCP: normal jobs use PC -> Hostinger.
  return eligible.some((p) => p.clientId === OPENCLAW_VPS_CLIENT_ID)
    ? OPENCLAW_VPS_CLIENT_ID : null;
}
