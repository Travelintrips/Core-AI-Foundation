import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DevBridgeEvidenceReader } from "./aiCoreDevBridgeEvidenceAdapters.js";

/**
 * Concrete DEV evidence reader. Caller supplies an already-authorized DEV-only
 * database query implementation. Never reuse a PROD pool or accept SQL from HTTP.
 */
export type DevBridgeQuery = <T extends Record<string, unknown>>(
  statement: string, values: readonly string[],
) => Promise<readonly T[]>;

type JobRow = {
  id: string; source: string; source_session_id: string | null;
  status: string; callback_received_at: string | null; result_verified_at: string | null;
};
type EventRow = { event_id: string; kind: string; sender: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const device = /^zfold4-[a-zA-Z0-9_-]{3,48}$/;

export function createDevBridgeEvidenceReader(
  query: DevBridgeQuery,
  registryDirectory: string = "/var/lib/openclaw-android-bridge-dev",
): DevBridgeEvidenceReader {
  return {
    async getJob(jobId) {
      if (!uuid.test(jobId)) return null;
      const rows = await query<JobRow>(
        "SELECT id::text, source, source_session_id, status, callback_received_at::text, result_verified_at::text FROM ai_task_bridge.jobs WHERE id = $1::uuid AND source = 'OPENCLAW' LIMIT 1",
        [jobId],
      );
      return rows[0] ?? null;
    },
    async getJobEvents(jobId) {
      if (!uuid.test(jobId)) return [];
      return await query<EventRow>(
        "SELECT event_id, kind, sender FROM ai_task_bridge.job_events WHERE job_id = $1::uuid ORDER BY received_at",
        [jobId],
      );
    },
    async isCurrentlyPaired(deviceId) {
      if (!device.test(deviceId)) return false;
      // Pairing state is owned by the trusted DEV broker, not Supabase jobs.
      // The broker writes this registry with restricted filesystem permissions.
      const raw = await readFile(join(registryDirectory, "device-registry.json"), "utf8");
      const registry: unknown = JSON.parse(raw);
      if (!registry || typeof registry !== "object" || Array.isArray(registry)) return false;
      const entry = (registry as Record<string, unknown>)[deviceId];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const value = entry as Record<string, unknown>;
      return value["active"] === true && typeof value["hash"] === "string" && value["hash"].length === 64;
    },
  };
}
