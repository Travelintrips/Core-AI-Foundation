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
// Add guards for undefined messages
const originalInfo = logger.info;
const originalError = logger.error;
const originalWarn = logger.warn;
const originalDebug = logger.debug;
const originalTrace = logger.trace;
const originalFatal = logger.fatal;

logger.info = (msg: string = "", ...args: unknown[]) => originalInfo(msg, ...args);
logger.error = (msg: string = "", ...args: unknown[]) => originalError(msg, ...args);
logger.warn = (msg: string = "", ...args: unknown[]) => originalWarn(msg, ...args);
logger.debug = (msg: string = "", ...args: unknown[]) => originalDebug(msg, ...args);
logger.trace = (msg: string = "", ...args: unknown[]) => originalTrace(msg, ...args);
logger.fatal = (msg: string = "", ...args: unknown[]) => originalFatal(msg, ...args);

