import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * Temporary diagnostic helper to capture workflow cancellation triggers in CI runs.
 */
export function logCancellationTrigger(eventType: string, error?: Error): void {
  logger.warn(
    {
      timestamp: new Date().toISOString(),
      eventType,
      stack: error?.stack ?? new Error().stack,
    },
    `[CI] Workflow cancellation trigger: ${eventType}`
  );
}

if (process.env.CI) {
  const handleCancel = (signal: string) => {
    logCancellationTrigger(signal);
  };
  process.once("SIGTERM", () => handleCancel("SIGTERM"));
  process.once("SIGINT", () => handleCancel("SIGINT"));
}
