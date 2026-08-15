/**
 * Server entry point.
 *
 * IMPORTANT: GCP Secret Manager bootstrap MUST run before any module that
 * reads process.env at import time (DB pool, auth middleware, etc.).
 * We achieve this by:
 *   1. Statically importing only the bootstrap (it is env-neutral at init time).
 *   2. Awaiting the bootstrap (top-level await in ESM).
 *   3. Dynamically importing everything else so their module-level code runs
 *      after the env vars have been injected.
 */

import { bootstrapGcpSecrets } from "./lib/gcpSecretsBootstrap.js";

// ── Step 1: Inject secrets from GCP Secret Manager (no-op in dev) ─────────────
await bootstrapGcpSecrets();

// ── Step 2: Production database safety guard ──────────────────────────────────
// Must run after bootstrap so SUPABASE_PROD_DATABASE_URL is available.
if (process.env["NODE_ENV"] === "production") {
  const prodUrl = process.env["SUPABASE_PROD_DATABASE_URL"];
  const legacyAlias = process.env["SUPABASE_DATABASE_URL"];
  if (!prodUrl && !legacyAlias) {
    console.error(
      "[startup] FATAL: NODE_ENV=production but SUPABASE_PROD_DATABASE_URL is not set. " +
      "The application refuses to start in production without an explicit production " +
      "database URL. Set SUPABASE_PROD_DATABASE_URL (or store it in GCP Secret Manager) " +
      "before deploying.",
    );
    process.exit(1);
  }
  if (!prodUrl && legacyAlias) {
    console.warn(
      "[startup] WARNING: SUPABASE_PROD_DATABASE_URL is not set; falling back to " +
      "SUPABASE_DATABASE_URL. Set the canonical production variable to silence this warning.",
    );
  }
}

// ── Step 3: Dynamic imports — all env-dependent modules load here ─────────────
const { default: app }              = await import("./app.js");
const { logger }                    = await import("./lib/logger.js");
const jobDispatcher                 = await import("./services/jobDispatcherService.js");
const scheduler                     = await import("./services/aiSchedulerService.js");
const sseManager                    = await import("./services/sseManager.js");
const healthAlerts                  = await import("./services/providerHealthAlertService.js");
const { ensureObservabilityTables } = await import("./services/observabilityService.js");
const { ensureMaterialLibraryTables, seedMaterialLibraryIfEmpty } =
  await import("./domains/material-library/seed.js");
const { ensureStorageBucket }       = await import("./lib/supabaseStorage.js");
const { resumeIncompleteDesignRenderBatches } =
  await import("./services/design-recovery/startupResume.js");
const { ensureSubmitIdempotencyTable } =
  await import("./services/submitIdempotencyService.js");
const { verifyMaterialImportTables } =
  await import("./services/materialImportService.js");

// ── Startup recovery idempotency guard ────────────────────────────────────────
let _designBatchRecoveryStarted = false;

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
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

  // ── Submit idempotency table ───────────────────────────────────────────────
  ensureSubmitIdempotencyTable().catch((err) =>
    logger.warn({ err }, "[submit-idempotency] Table init failed (non-blocking)"),
  );

  // ── Material Library tables + conditional seed ────────────────────────────
  ensureMaterialLibraryTables()
    .then(() => seedMaterialLibraryIfEmpty())
    .catch((err) =>
      logger.warn({ err }, "[material-library] Table/seed init failed (non-blocking)"),
    );

  verifyMaterialImportTables().catch((err) =>
    logger.warn({ err }, "[material-import] Phase 5 table verification failed (non-blocking)"),
  );

  // ── Supabase Storage bucket ───────────────────────────────────────────────
  ensureStorageBucket().catch((err) =>
    logger.warn({ err }, "[supabaseStorage] Bucket init failed (non-blocking)"),
  );

  // ── Dispatcher auto-start ────────────────────────────────────────────────
  const isProduction      = process.env["NODE_ENV"] === "production";
  const dispatcherEnabled = isProduction
    ? process.env["AI_DISPATCHER_ENABLED"] === "true"
    : true;

  if (dispatcherEnabled) {
    jobDispatcher.start().catch((startErr) =>
      logger.error({ err: startErr }, "[dispatcher] Failed to auto-start"),
    );

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

  // ── Scheduler auto-start ─────────────────────────────────────────────────
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

  // ── Provider health alert poller ─────────────────────────────────────────
  healthAlerts.start().catch((startErr) =>
    logger.error({ err: startErr }, "[health-alerts] Failed to auto-start"),
  );
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down dispatcher, scheduler, health alerts, and SSE`);
  sseManager.shutdown();
  healthAlerts.shutdown();
  Promise.all([scheduler.shutdown(), jobDispatcher.shutdown()])
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
