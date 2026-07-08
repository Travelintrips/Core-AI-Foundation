import app from "./app";
import { logger } from "./lib/logger";
import { isDispatcherEnabled, startDispatcher } from "./services/jobDispatcherService";

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
});
