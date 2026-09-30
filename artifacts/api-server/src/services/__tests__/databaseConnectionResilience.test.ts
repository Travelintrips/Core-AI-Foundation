import { describe, expect, it } from "vitest";

process.env["SUPABASE_DEV_DATABASE_URL"] ??=
  "postgresql://test:test@127.0.0.1:5432/test";

describe("database connection resilience", () => {
  it("recognizes transient connection errors wrapped by Drizzle", async () => {
    const { isTransientDatabaseConnectionError } = await import("@workspace/db");
    const wrapped = new Error("Failed query: select * from ai_platform.ai_models", {
      cause: new Error("timeout exceeded when trying to connect"),
    });

    expect(isTransientDatabaseConnectionError(wrapped)).toBe(true);
  });

  it("retries a wrapped transient failure and then succeeds", async () => {
    const { withTransientDatabaseRetry } = await import("@workspace/db");
    let attempts = 0;
    const result = await withTransientDatabaseRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("Failed query: select 1", {
          cause: Object.assign(new Error("connection timed out"), { code: "08006" }),
        });
      }
      return "ok";
    }, { attempts: 3, baseDelayMs: 25 });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });
});
