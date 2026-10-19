import pino from "pino";

/**
 * Reproduction & Root Cause Analysis:
 * - CI/test runs fail when pino-pretty transport is initialized in CI or test runners.
 * - Affected module: artifacts/api-server logger initialization.
 */
const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.NODE_ENV === "test" ||
  Boolean(process.env.CI);

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
