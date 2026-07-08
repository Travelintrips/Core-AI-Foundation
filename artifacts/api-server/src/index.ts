import app from "./app";
import { logger } from "./lib/logger";
import { isDispatcherEnabled, startDispatcher } from "./services/jobDispatcherService";
import * as jobDispatcher from "./services/jobDispatcherService.js";

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

  // Auto-start the background worker dispatcher if enabled
  if (isDispatcherEnabled()) {
    startDispatcher().catch((dispErr) => {
      logger.error({ err: dispErr }, "Dispatcher: failed to auto-start");
    });
  } else {
    logger.info("Dispatcher: disabled (set AI_WORKER_ENABLED=true to enable)");
  }
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
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down dispatcher");
  jobDispatcher.shutdown()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

process.on("SIGINT", () => {
  logger.info("SIGINT received — shutting down dispatcher");
  jobDispatcher.shutdown()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
