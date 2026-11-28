/** The DEV monitor receives bounded snapshots, not authoritative global totals.
 * Missing, invalid, or partial reads must never be interpreted as zero work. */
export type JobMonitorAvailability = "loading" | "ready" | "partial" | "unavailable";
export type AssistanceAvailability = "loading" | "ready" | "unavailable";

type MonitorJobShape = { id: string; title: string; source: string; status: string };
type AssistanceShape = { job_key: string; task_code: string; status: string; resumeAllowed: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseJobMonitorSnapshot<T extends MonitorJobShape>(value: unknown): { jobs: T[]; warnings: string[] } {
  if (!isRecord(value) || !Array.isArray(value.jobs) ||
      value.jobs.some(job => !isRecord(job) ||
        !["id", "title", "source", "status"].every(key => typeof job[key] === "string")) ||
      !Array.isArray(value.warnings) || value.warnings.some(warning => typeof warning !== "string")) {
    throw new Error("Format data monitoring tidak valid.");
  }
  return { jobs: value.jobs as T[], warnings: value.warnings as string[] };
}

export function parseHumanAssistanceSnapshot<T extends AssistanceShape>(value: unknown): Record<string, T> {
  if (!isRecord(value) || !Array.isArray(value.requests) ||
      value.requests.some(item => !isRecord(item) ||
        typeof item.job_key !== "string" || !item.job_key ||
        typeof item.task_code !== "string" || typeof item.status !== "string" ||
        item.resumeAllowed !== false)) {
    throw new Error("HUMAN_ASSISTANCE_UNAVAILABLE");
  }
  // Source is newest-first; preserve the first record for each key.
  const records = new Map<string, T>();
  for (const item of value.requests as T[]) {
    if (!records.has(item.job_key)) records.set(item.job_key, item);
  }
  return Object.fromEntries(records);
}

export function jobMonitorAvailability(loading: boolean, updated: string | null, error: string | null, warnings: readonly string[]): JobMonitorAvailability {
  if (error !== null) return "unavailable";
  if (!updated) return loading ? "loading" : "unavailable";
  return warnings.length > 0 ? "partial" : "ready";
}

export function jobMonitorCount(count: number, availability: JobMonitorAvailability): string {
  if (availability === "ready") return String(count);
  if (availability === "partial" && count > 0) return String(count) + "*";
  return "—";
}

export function canUseJobMonitorActions(availability: JobMonitorAvailability): boolean {
  return availability === "ready";
}

export function canUseHumanAssistance(availability: JobMonitorAvailability, assistance: AssistanceAvailability): boolean {
  return canUseJobMonitorActions(availability) && assistance === "ready";
}

/** Prevent overlapping polls; a timeout/abort also releases the lock. */
export function createJobMonitorPollGate() {
  let busy = false;
  return {
    async run(load: () => Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try {
        await load();
        return true;
      } finally {
        busy = false;
      }
    },
  };
}
