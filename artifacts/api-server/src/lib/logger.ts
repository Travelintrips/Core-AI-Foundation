import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Root cause: process.env.NODE_ENV lacks proper type definition, causing TS build failure in CI. Add declaration in env types.
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
