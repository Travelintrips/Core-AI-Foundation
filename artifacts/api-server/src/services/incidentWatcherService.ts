import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { processOpenIncidents, syncIncidentRepairStatuses, upsertIncident } from "./incidentAutoRepairService.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

async function checkDatabase(): Promise<void> {
  const started = Date.now();
  try {
    await pool.query("select 1 as ok");
    const latencyMs = Date.now() - started;
    if (latencyMs > 5000) {
      await upsertIncident({
        source: "supabase",
        kind: "database_latency",
        title: "Supabase database latency is high",
        summary: `Database health query took ${latencyMs}ms.`,
        severity: "warning",
        riskClass: "GUARDED",
        repository: "Travelintrips/Core-AI-Foundation",
        branch: "main",
        metadata: { latencyMs },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertIncident({
      source: "supabase",
      kind: "database_connectivity",
      title: "Supabase database health check failed",
      summary: message.slice(0, 1500),
      severity: "critical",
      riskClass: "GUARDED",
      repository: "Travelintrips/Core-AI-Foundation",
      branch: "main",
    }).catch(() => undefined);
  }
}

export async function tickIncidentWatcher(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await checkDatabase();
    await syncIncidentRepairStatuses(50);
    await processOpenIncidents(5);
  } finally {
    running = false;
  }
}

export async function start(): Promise<void> {
  if (timer) return;
  await tickIncidentWatcher();
  const intervalMs = Math.max(60_000, Number(process.env["AI_INCIDENT_POLL_INTERVAL_MS"]) || 300_000);
  timer = setInterval(() => { void tickIncidentWatcher().catch(err => logger.warn({ err }, "[incident] watcher tick failed")); }, intervalMs);
  timer.unref?.();
  logger.info({ intervalMs }, "[incident] watcher started");
}

export function shutdown(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
