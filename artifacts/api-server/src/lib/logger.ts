import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "secret",
    "token",
    "password",
    "apiKey",
    "*.secret",
    "*.token",
    "*.password",
    "*.apiKey",
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

export interface GateEvaluationLog {
  environment: string;
  gate: string;
  evaluation: string;
  decision: "allow" | "deny" | "warn" | "skip" | string;
  details?: Record<string, unknown>;
}

export function logGateDecision(data: GateEvaluationLog): void {
  logger.info(
    {
      gateEvaluation: {
        environment: data.environment,
        gate: data.gate,
        evaluation: data.evaluation,
        decision: data.decision,
        details: data.details,
      },
    },
    `Release gate [${data.gate}] evaluated with decision: ${data.decision}`
  );
}
