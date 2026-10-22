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

// Capture CI cancellation events in production
if (isProduction) {
  const captureCiCancellation = (): void => {
    const timestamp = new Date().toISOString();
    const signal = process.env.CI_CANCELLATION_SIGNAL || 'SIGTERM';
    logger.info({ event: 'ci_cancellation', timestamp, signal }, 'CI cancellation event detected');
  };

  process.on('SIGTERM', captureCiCancellation);
  process.on('SIGINT', captureCiCancellation);
}

