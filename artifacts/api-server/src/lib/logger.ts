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
// Instrumentation for detailed debug statements
if (!isProduction) {
  ['trace','debug','info','warn','error','fatal'].forEach((level) => {
    const orig = (logger as any)[level];
    (logger as any)[level] = (...args: any[]) => {
      const start = Date.now();
      const res = orig(...args);
      const duration = Date.now() - start;
      orig('LOGGER_INSTRUMENT', { level, duration, args, stack: new Error().stack });
      return res;
    };
  });
}

