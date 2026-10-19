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
 * Logs the incoming intent payload and the matched handler name at debug level.
 * Useful for CI debugging of chat intent routing.
 */
export function logIntent(intentPayload: unknown, handlerName: string): void {
  logger.debug({ intentPayload, handlerName }, 'Intent routed');
}

