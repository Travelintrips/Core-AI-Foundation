import pino from "pino";

// OpenClaw routing failure: In CI environments, pino-pretty worker transport can interrupt job routing execution.
const isProduction = process.env.NODE_ENV === "production" || process.env.CI === "true";

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
