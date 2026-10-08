/**
 * DEV worker sandbox: exercises dispatcher/scheduler lifecycle using only
 * explicit no-op smoke tasks. All production environments ignore this flag.
 * Never use this to authorize a non-noop job or an external notification.
 */
export function isDevSafeRuntimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["APP_ENV"]?.trim().toLowerCase() === "development" &&
    env["NODE_ENV"]?.trim().toLowerCase() !== "production" &&
    env["AI_DEV_SAFE_WORKERS_ENABLED"] === "true";
}

export function assertDevSafeRuntimeConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env["AI_DEV_SAFE_WORKERS_ENABLED"] === "true" && !isDevSafeRuntimeEnabled(env)) {
    throw new Error(
      "AI_DEV_SAFE_WORKERS_ENABLED requires APP_ENV=development and NODE_ENV!=production.",
    );
  }
}

export function isDevSmokeJob(jobType: unknown, payload: unknown): boolean {
  if (jobType !== "noop" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  return (payload as Record<string, unknown>)["_devSmoke"] === true;
}

export function isDevSmokeSchedule(schedule: {
  targetType: unknown;
  targetConfigJson: unknown;
  payloadJson: unknown;
}): boolean {
  if (schedule.targetType !== "create_job" || !schedule.targetConfigJson ||
      typeof schedule.targetConfigJson !== "object" ||
      Array.isArray(schedule.targetConfigJson)) return false;
  const jobType = (schedule.targetConfigJson as Record<string, unknown>)["jobType"];
  return isDevSmokeJob(jobType, schedule.payloadJson);
}
