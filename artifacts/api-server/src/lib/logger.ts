import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Document workflow cancellation propagation: workflow_run cancellation propagates via localCodingGitHubPullRequestService handling SIGTERM / workflow abort signals.
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
