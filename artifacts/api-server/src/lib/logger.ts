/*
Reproduction steps:
1. pnpm typecheck
2. pnpm build
3. pnpm --filter @workspace/api-server test
4. pnpm --filter @workspace/api-server typecheck
Review the logs for the specific error or timeout causing the cancellation.
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
