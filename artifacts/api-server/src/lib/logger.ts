import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "password",
    "token",
    "secret",
    "authorization",
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

export interface AutoRetryLogContext {
  errorType: string;
  retryCount: number;
  timestamp?: string;
  [key: string]: unknown;
}

export const localCodingAutonomousRepairLogger = logger.child({
  service: "localCodingAutonomousRepairService",
});

export const logAutoRetryEvent = (
  context: AutoRetryLogContext,
  message = "Auto-retry event occurred"
): void => {
  localCodingAutonomousRepairLogger.info(
    {
      timestamp: context.timestamp ?? new Date().toISOString(),
      errorType: context.errorType,
      retryCount: context.retryCount,
      ...context,
    },
    message
  );
};
