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

export interface CIWorkflowCancellationContext {
  workflowRunId: string | number;
  status?: string;
  stepName?: string;
  timestamp?: string;
  errorMessage?: string;
  timeoutMessage?: string;
  commitSha?: string;
  jobId?: string | number;
  [key: string]: unknown;
}

export function logWorkflowCancelled(context: CIWorkflowCancellationContext): void {
  logger.warn(
    {
      event: "ci_workflow_cancelled",
      workflow_run_id: context.workflowRunId,
      status: context.status ?? "cancelled",
      step_name: context.stepName,
      timestamp: context.timestamp ?? new Date().toISOString(),
      error_message: context.errorMessage,
      timeout_message: context.timeoutMessage,
      commit_sha: context.commitSha,
      job_id: context.jobId,
    },
    `CI workflow run ${context.workflowRunId} cancelled`
  );
}
