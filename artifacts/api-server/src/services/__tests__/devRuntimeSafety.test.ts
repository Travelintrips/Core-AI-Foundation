import { describe, expect, it } from "vitest";
import {
  assertDevSafeRuntimeConfiguration,
  isDevSafeRuntimeEnabled,
  isDevSmokeJob,
  isDevSmokeSchedule,
} from "../devRuntimeSafety.js";

const safeEnv: NodeJS.ProcessEnv = {
  APP_ENV: "development",
  NODE_ENV: "development",
  AI_DEV_SAFE_WORKERS_ENABLED: "true",
};

describe("DEV safe worker sandbox", () => {
  it("requires explicit opt-in and a non-production environment", () => {
    expect(isDevSafeRuntimeEnabled(safeEnv)).toBe(true);
    for (const changed of [
      { AI_DEV_SAFE_WORKERS_ENABLED: "false" },
      { APP_ENV: "production" },
      { NODE_ENV: "production" },
      { APP_ENV: undefined },
    ]) {
      const unsafeEnv = { ...safeEnv, ...changed };
      expect(isDevSafeRuntimeEnabled(unsafeEnv)).toBe(false);
      if (unsafeEnv.AI_DEV_SAFE_WORKERS_ENABLED === "true") {
        expect(() => assertDevSafeRuntimeConfiguration(unsafeEnv)).toThrow();
      }
    }
    expect(() => assertDevSafeRuntimeConfiguration(safeEnv)).not.toThrow();
  });

  it("permits explicitly tagged no-op jobs and rejects other job types", () => {
    expect(isDevSmokeJob("noop", { _devSmoke: true })).toBe(true);
    expect(isDevSmokeJob("noop", {})).toBe(false);
    expect(isDevSmokeJob("coding_ai_execution", { _devSmoke: true })).toBe(false);
    expect(isDevSmokeJob("noop", { _devSmoke: "true" })).toBe(false);
    expect(isDevSmokeJob("noop", null)).toBe(false);
  });

  it("executes only explicitly tagged no-op schedules", () => {
    const allowed = {
      targetType: "create_job", targetConfigJson: { jobType: "noop" },
      payloadJson: { _devSmoke: true },
    };
    expect(isDevSmokeSchedule(allowed)).toBe(true);
    expect(isDevSmokeSchedule({ ...allowed, targetType: "webhook" })).toBe(false);
    expect(isDevSmokeSchedule({ ...allowed, targetConfigJson: { jobType: "coding_ai_execution" } })).toBe(false);
    expect(isDevSmokeSchedule({ ...allowed, payloadJson: {} })).toBe(false);
    expect(isDevSmokeSchedule({ ...allowed, targetConfigJson: null })).toBe(false);
  });
});
