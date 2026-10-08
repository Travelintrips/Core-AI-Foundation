export const OPENCLAW_VPS_CLIENT_ID = "openclaw-vps-main" as const;
export const OPENCLAW_PC_CLIENT_ID = "openclaw-pc-worker" as const;
export const OPENCLAW_LEGACY_CLIENT_ID = "gcp-openclaw-main" as const;

type ExecutorPresence = { clientId: string; eligible: boolean };

/** Resolve new jobs only. Expired in-flight claims need an independent, idempotent recovery protocol. */
export function selectOpenClawExecutor(presences: readonly ExecutorPresence[]): string | null {
  const healthy = new Set(presences.filter((p) => p.eligible).map((p) => p.clientId));
  return [OPENCLAW_VPS_CLIENT_ID, OPENCLAW_PC_CLIENT_ID, OPENCLAW_LEGACY_CLIENT_ID]
    .find((id) => healthy.has(id)) ?? null;
}
