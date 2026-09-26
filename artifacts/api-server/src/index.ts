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
const incidentWatcher                = await import("./services/incidentWatcherService.js");
const ollamaWorkerRuntime             = await import("./services/ollamaWorkerRuntimeService.js");
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
const { failStaleRepositoryAnalyzerRuns } =
  await import("./services/repositoryAnalyzerService.js");
const { reconcileStaleMultiWorkerRuns } =
  await import("./services/localCodingMultiWorkerRecoveryService.js");
const { ensureCodingControlBridgeTables } =
  await import("./services/codingControlBridgeSchemaService.js");

// ── Startup recovery idempotency guard ────────────────────────────────────────
let _designBatchRecoveryStarted = false;

// Hostinger may not expose PORT to the Node process even though its reverse proxy
// expects the application on the platform's conventional application port.
const rawPort = process.env["PORT"] ?? "3000";
if (!process.env["PORT"]) {
  console.warn("[startup] PORT was not provided; defaulting to 3000.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function isProductionRuntime(): boolean {
  return process.env["NODE_ENV"] === "production";
}

async function runStartupStep(
  label: string,
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task();
  } catch (err) {
    logger.warn({ err }, `${label} failed (non-blocking)`);
  }
}

async function initializeRuntimeServices(): Promise<void> {
  // Run startup DB work sequentially. Hostinger performs rolling deploys and
  // can overlap processes briefly; firing every initializer concurrently caused
  // Supabase session-pool exhaustion during deploys.
  await runStartupStep("[observability] Table init", () => ensureObservabilityTables());
  await runStartupStep("[submit-idempotency] Table init", () => ensureSubmitIdempotencyTable());
  await runStartupStep("[coding-bridge] Table init", () => ensureCodingControlBridgeTables());
  await runStartupStep("[material-library] Table/seed init", async () => {
    await ensureMaterialLibraryTables();
    await seedMaterialLibraryIfEmpty();
  });
  await runStartupStep("[material-import] Phase 5 table verification", () => verifyMaterialImportTables());
  await runStartupStep("[coding-analyzer] Stale run recovery", async () => {
    const recovered = await failStaleRepositoryAnalyzerRuns();
    if (recovered > 0) {
      logger.warn({ recovered }, "[coding-analyzer] Recovered stale RUNNING analyzer rows");
    }
  });
  await runStartupStep("[coding-multi-worker] Stale run recovery", async () => {
    const recovered = await reconcileStaleMultiWorkerRuns();
    if (
      recovered.recoveredRuns > 0 ||
      recovered.recoveredWorkstreams > 0 ||
      recovered.recoveredTasks > 0 ||
      recovered.recoveredJobs > 0
    ) {
      logger.warn(recovered, "[coding-multi-worker] Recovered stale multi-worker lifecycle rows");
    }
  });
  // Production storage buckets are infrastructure and already provisioned.
  // Do not consume a privileged Storage API call on every rolling deployment.
  // Development still self-provisions for convenience.
  if (!isProductionRuntime()) {
    await runStartupStep("[supabaseStorage] Bucket init", () => ensureStorageBucket());
  }

  const isProduction = process.env["NODE_ENV"] === "production";

  if (process.env["OLLAMA_WORKER_RUNTIME_ENABLED"] === "true") {
    await runStartupStep(
      "[ollama-worker] Runtime start",
      () => ollamaWorkerRuntime.startOllamaWorkerRuntime(),
    );
  }

  // Production workers fail closed: they only auto-start when explicitly enabled.
  // Development keeps the existing auto-start behavior for local workflows.
  const productionWorkersAllowed = process.env["AI_PRODUCTION_WORKERS_ALLOWED"] === "true";
  const dispatcherFlag = process.env["AI_DISPATCHER_ENABLED"];
  const dispatcherEnabled = isProduction
    ? productionWorkersAllowed && dispatcherFlag === "true"
    : true;

  if (dispatcherEnabled) {
    try {
      await jobDispatcher.start();
    } catch (err) {
      logger.error({ err }, "[dispatcher] Failed to auto-start");
    }

    if (!_designBatchRecoveryStarted) {
      _designBatchRecoveryStarted = true;
      await runStartupStep("[design-batch-recovery] Startup recovery", async () => {
        const result = await resumeIncompleteDesignRenderBatches();
        if (result.batchesResumed > 0 || result.batchesCancelled > 0 || result.staleRecovery.scannedCount > 0) {
          logger.info(result, "[design-batch-recovery] Startup recovery complete");
        }
      });
    }
  } else {
    logger.info("[dispatcher] Auto-start disabled (production requires AI_PRODUCTION_WORKERS_ALLOWED=true and AI_DISPATCHER_ENABLED=true)");
  }

  const schedulerFlag = process.env["AI_SCHEDULER_ENABLED"];
  const schedulerEnabled = isProduction
    ? productionWorkersAllowed && schedulerFlag === "true"
    : true;

  const pollIntervalMs = Number(process.env["AI_SCHEDULER_POLL_INTERVAL_MS"]);
  const timezone = process.env["AI_SCHEDULER_TIMEZONE"];
  scheduler.updateSettings({
    schedulerEnabled,
    ...(Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? { pollIntervalMs } : {}),
    ...(timezone ? { timezone } : {}),
  });

  if (schedulerEnabled) {
    try {
      await scheduler.start();
    } catch (err) {
      logger.error({ err }, "[scheduler] Failed to auto-start");
    }
  } else {
    logger.info("[scheduler] Auto-start disabled (production requires AI_PRODUCTION_WORKERS_ALLOWED=true and AI_SCHEDULER_ENABLED=true)");
  }

  try {
    await healthAlerts.start();
  } catch (err) {
    logger.error({ err }, "[health-alerts] Failed to auto-start");
  }

  const incidentWatcherEnabled = process.env["AI_INCIDENT_WATCHER_ENABLED"] !== "false";
  if (incidentWatcherEnabled) {
    await runStartupStep("[incident] Watcher start", () => incidentWatcher.start());
  } else {
    logger.info("[incident] Watcher disabled by AI_INCIDENT_WATCHER_ENABLED=false");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void initializeRuntimeServices();
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down dispatcher, scheduler, health alerts, and SSE`);
  sseManager.shutdown();
  healthAlerts.shutdown();
  incidentWatcher.shutdown();
  Promise.all([
    scheduler.shutdown(),
    jobDispatcher.shutdown(),
    ollamaWorkerRuntime.shutdownOllamaWorkerRuntime(),
  ])
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
