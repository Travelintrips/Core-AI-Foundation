import pino from "pino";
import * as fs from "fs";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  base: (() => {
    if (process.env.GITHUB_ACTIONS === "true") {
      let cancelReason = null;
      try {
        const eventPath = process.env.GITHUB_EVENT_PATH;
        if (eventPath) {
          const event = JSON.parse(fs.readFileSync(eventPath, "utf-8"));
          cancelReason = event.workflow_run?.conclusion === "cancelled"
            ? event.workflow_run?.cancellation_reason || null
            : null;
        }
      } catch {}
      return {
        github_workflow: process.env.GITHUB_WORKFLOW,
        github_run_id: process.env.GITHUB_RUN_ID,
        github_cancel_reason: cancelReason,
      };
    }
    return {};
  })(),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
