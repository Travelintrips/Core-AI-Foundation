/**
 * Failure Analysis (commit 8c753f89dc1e42a1c023e37db66b4f7e7781abc9):
 * Service: aiCoreChatIntentService
 * Hypothesis: aiCoreChatIntentService is missing an explicit subscription to the event stream.
 */
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
