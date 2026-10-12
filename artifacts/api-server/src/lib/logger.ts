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
// Wrap error method to accept optional context object
const originalError = logger.error.bind(logger);
logger.error = (message: string, context: Record<string, any> = {}, ...args: any[]) => {
  if (Object.keys(context).length) {
    originalError({ ...context }, message, ...args);
  } else {
    originalError(message, ...args);
  }
};

