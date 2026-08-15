import { logger } from "./lib/logger";
import { loadApplicationSecrets } from "./lib/gcpSecretManager.js";

try {
  await loadApplicationSecrets();
} catch (error) {
  logger.fatal({ err: error }, "[startup] Failed to load application secrets");
  process.exit(1);
}

// Import the application only after Google Cloud secrets have been loaded so
// database clients and route modules see the canonical runtime configuration.
const { default: app } = await import("./app.js");

// ── Production database safety guard — must run before any DB operation ───────
// If NODE_ENV=production but SUPABASE_PROD_DATABASE_URL is not set, the app
// would silently fall back to the SUPABASE_DATABASE_URL alias or throw an
// opaque error at query time. We fail closed here instead.
if (process.env["NODE_ENV"] === "production") {
  const prodUrl = process.env["SUPABASE_PROD_DATABASE_URL"];
  const legacyAlias = process.env["SUPABASE_DATABASE_URL"]; // alias used by some envs
  if (!prodUrl && !legacyAlias) {
    // eslint-disable-next-line no-console
    console.error(
      "[startup] FATAL: NODE_ENV=production but SUPABASE_PROD_DATABASE_URL is not set. " +
      "The application refuses to start in production without an explicit production " +
      "database URL. Set SUPABASE_PROD_DATABASE_URL before deploying.",
    );
    process.exit(1);
  }
  if (!prodUrl && legacyAlias) {
    // Allow the legacy alias but warn loudly so operators notice
    // eslint-disable-next-line no-console
    console.warn(
      "[startup] WARNING: SUPABASE_PROD_DATABASE_URL is not set; falling back to " +
      "SUPABASE_DATABASE_URL. Set the canonical production variable to silence this warning.",
    );
  }
}
const jobDispatcher = await import("./services/jobDispatcherService.js");
const scheduler = await import("./services/aiSchedulerService.js");
const sseManager = await import("./services/sseManager.js");
const healthAlerts = await import("./services/providerHealthAlertService.js");
const { ensureObservabilityTables } = await import("./services/observabilityService.js");
const { ensureMaterialLibraryTables, seedMaterialLibraryIfEmpty } =
  await import("./domains/material-library/seed.js");
const { ensureStorageBucket } = await import("./lib/supabaseStorage.js");
const { resumeIncompleteDesignRenderBatches } =
  await import("./services/design-recovery/startupResume.js");
const { ensureSubmitIdempotencyTable } =
  await import("./services/submitIdempotencyService.js");
const { verifyMaterialImportTables } =
  await import("./services/materialImportService.js");

// ── Startup recovery idempotency guard ────────────────────────────────────────
// Prevents the recovery from running twice if the API server and job worker
// share the same process (e.g. in development single-process mode).
let _designBatchRecoveryStarted = false;

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

  // ── Submit idempotency table (DEF-001: DB-backed dedup guarantee) ─────────
  ensureSubmitIdempotencyTable().catch((err) =>
    logger.warn({ err }, "[submit-idempotency] Table init failed (non-blocking)"),
  );

  // ── Material Library tables + conditional seed (Phase 1) ─────────────────
  // Only seeds when catalog is empty / below baseline — avoids 500+ upserts
  // on every boot. Use POST /api/material-library/seed (admin) for a full sync.
  ensureMaterialLibraryTables()
    .then(() => seedMaterialLibraryIfEmpty())
    .catch((err) =>
      logger.warn({ err }, "[material-library] Table/seed init failed (non-blocking)"),
    );

  verifyMaterialImportTables().catch((err) =>
    logger.warn({ err }, "[material-import] Phase 5 table verification failed (non-blocking)"),
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

    // ── Design batch startup recovery (Phase 3A) ────────────────────────────
    // Re-enqueues interrupted design render batches left in non-terminal states
    // after a process crash. Runs only when the dispatcher is active (recovery
    // re-enqueues jobs, so a running dispatcher is required). The idempotency
    // guard prevents a double-run if the API server and job worker share the
    // same Node.js process.
    if (!_designBatchRecoveryStarted) {
      _designBatchRecoveryStarted = true;
      resumeIncompleteDesignRenderBatches()
        .then((result) => {
          if (result.batchesResumed > 0 || result.batchesCancelled > 0 || result.staleRecovery.scannedCount > 0) {
            logger.info(result, "[design-batch-recovery] Startup recovery complete");
          }
        })
        .catch((err) =>
          logger.warn({ err }, "[design-batch-recovery] Startup recovery failed (non-blocking)"),
        );
    }
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

  // ── Provider health alert poller (Task #9) ───────────────────────────────
  // Seeds default alert settings and starts the background poll loop.
  // Non-fatal: failure here must not block server startup.
  healthAlerts.start().catch((startErr) =>
    logger.error({ err: startErr }, "[health-alerts] Failed to auto-start"),
  );
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down dispatcher, scheduler, health alerts, and SSE`);
  sseManager.shutdown(); // close SSE connections first (fast, synchronous)
  healthAlerts.shutdown();
  Promise.all([scheduler.shutdown(), jobDispatcher.shutdown()])
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
