import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// TODO: Extend logger to capture correlationId, error codes, and timestamps for debugging agent-runtime failures
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
