import app from "./app";
import { logger } from "./lib/logger";
import * as jobDispatcher from "./services/jobDispatcherService.js";
import * as scheduler from "./services/aiSchedulerService.js";
import * as sseManager from "./services/sseManager.js";
import { ensureObservabilityTables } from "./services/observabilityService.js";
import { ensureStorageBucket } from "./lib/supabaseStorage.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // ── Observability tables (additive DDL, idempotent) ──────────────────────
  ensureObservabilityTables().catch((err) =>
    logger.warn({ err }, "[observability] Table init failed (non-blocking)"),
  );

  // ── Supabase Storage bucket (create ai-assets if missing) ────────────────
  ensureStorageBucket().catch((err) =>
    logger.warn({ err }, "[supabaseStorage] Bucket init failed (non-blocking)"),
  );

  // ── Dispatcher auto-start (Phase 5.1) ───────────────────────────────────
  // Dev: always auto-start
  // Prod: only when AI_DISPATCHER_ENABLED=true
  const isProduction     = process.env["NODE_ENV"] === "production";
  const dispatcherEnabled = isProduction
    ? process.env["AI_DISPATCHER_ENABLED"] === "true"
    : true;

  if (dispatcherEnabled) {
    jobDispatcher.start().catch((startErr) =>
      logger.error({ err: startErr }, "[dispatcher] Failed to auto-start"),
    );
  } else {
    logger.info("[dispatcher] Auto-start disabled (set AI_DISPATCHER_ENABLED=true to enable in production)");
  }

  // ── Scheduler auto-start (Phase 6) ──────────────────────────────────────
  // Dev: always auto-start
  // Prod: only when AI_SCHEDULER_ENABLED=true
  const schedulerEnabled = isProduction
    ? process.env["AI_SCHEDULER_ENABLED"] === "true"
    : true;

  const pollIntervalMs = Number(process.env["AI_SCHEDULER_POLL_INTERVAL_MS"]);
  const timezone = process.env["AI_SCHEDULER_TIMEZONE"];
  scheduler.updateSettings({
    schedulerEnabled,
    ...(Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? { pollIntervalMs } : {}),
    ...(timezone ? { timezone } : {}),
  });

  if (schedulerEnabled) {
    scheduler.start().catch((startErr) =>
      logger.error({ err: startErr }, "[scheduler] Failed to auto-start"),
    );
  } else {
    logger.info("[scheduler] Auto-start disabled (set AI_SCHEDULER_ENABLED=true to enable in production)");
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down dispatcher, scheduler, and SSE`);
  sseManager.shutdown(); // close SSE connections first (fast, synchronous)
  Promise.all([scheduler.shutdown(), jobDispatcher.shutdown()])
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
