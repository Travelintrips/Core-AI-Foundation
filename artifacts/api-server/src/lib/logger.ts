import pino from "pino";

const VALID_LOG_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

function getLogLevel(): string {
  const envLevel = typeof process.env.LOG_LEVEL === "string" ? process.env.LOG_LEVEL.trim().toLowerCase() : "";
  if (VALID_LOG_LEVELS.has(envLevel)) {
    return envLevel;
  }
  return "info";
}

function createLogger(): pino.Logger {
  try {
    const isProduction = process.env.NODE_ENV === "production";
    const level = getLogLevel();

    return pino({
      level,
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
  } catch (error) {
    console.error("Failed to initialize custom logger, falling back to basic logger:", error);
    try {
      return pino({ level: "info" });
    } catch {
      return pino();
    }
  }
}

export const logger = createLogger();
