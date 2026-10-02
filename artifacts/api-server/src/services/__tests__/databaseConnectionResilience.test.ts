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

  it("classifies PostgreSQL and Supavisor authentication failures as permanent", async () => {
    const {
      isDatabaseAuthenticationError,
      isTransientDatabaseConnectionError,
    } = await import("@workspace/db");

    const invalidPassword = Object.assign(
      new Error('password authentication failed for user "postgres"'),
      { code: "28P01" },
    );
    const breaker = new Error(
      "(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked",
    );
    const wrapped = new Error("Failed query: select 1", { cause: invalidPassword });

    expect(isDatabaseAuthenticationError(invalidPassword)).toBe(true);
    expect(isDatabaseAuthenticationError(breaker)).toBe(true);
    expect(isDatabaseAuthenticationError(wrapped)).toBe(true);
    expect(isTransientDatabaseConnectionError(invalidPassword)).toBe(false);
    expect(isDatabaseAuthenticationError(new Error("connection timed out"))).toBe(false);
  });

  it("does not retry authentication failures", async () => {
    const { withTransientDatabaseRetry } = await import("@workspace/db");
    let attempts = 0;

    await expect(
      withTransientDatabaseRetry(async () => {
        attempts += 1;
        throw Object.assign(
          new Error('password authentication failed for user "postgres"'),
          { code: "28P01" },
        );
      }, { attempts: 5, baseDelayMs: 25 }),
    ).rejects.toMatchObject({ code: "28P01" });

    expect(attempts).toBe(1);
  });
});


describe("production database URL resolution", () => {
  it("uses APP_ENV=production even when NODE_ENV is absent", async () => {
    const { resolveDatabaseUrl } = await import("@workspace/db");
    const url = resolveDatabaseUrl({
      APP_ENV: "production",
      SUPABASE_URL: "https://nzdweipzckfszczzqtuw.supabase.co",
      SUPABASE_PROD_DATABASE_URL:
        "postgresql://postgres:secret@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres",
      SUPABASE_DEV_DATABASE_URL:
        "postgresql://dev:secret@dev.example:5432/postgres",
    });

    const parsed = new URL(url);
    expect(parsed.hostname).toBe("aws-1-ap-southeast-2.pooler.supabase.com");
    expect(parsed.port).toBe("6543");
    expect(parsed.username).toBe("postgres.nzdweipzckfszczzqtuw");
  });

  it("keeps an already tenant-qualified Supavisor username", async () => {
    const { normalizeProductionPoolerUrl } = await import("@workspace/db");
    const url = normalizeProductionPoolerUrl(
      "postgresql://postgres.nzdweipzckfszczzqtuw:secret@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres",
      {
        APP_ENV: "production",
        SUPABASE_URL: "https://nzdweipzckfszczzqtuw.supabase.co",
      },
    );

    const parsed = new URL(url);
    expect(parsed.username).toBe("postgres.nzdweipzckfszczzqtuw");
    expect(parsed.port).toBe("6543");
  });

  it("preserves session mode when explicitly forced while still fixing the tenant username", async () => {
    const { normalizeProductionPoolerUrl } = await import("@workspace/db");
    const url = normalizeProductionPoolerUrl(
      "postgresql://postgres:secret@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres",
      {
        APP_ENV: "production",
        SUPABASE_URL: "https://nzdweipzckfszczzqtuw.supabase.co",
        SUPABASE_FORCE_SESSION_POOLER: "true",
      },
    );

    const parsed = new URL(url);
    expect(parsed.username).toBe("postgres.nzdweipzckfszczzqtuw");
    expect(parsed.port).toBe("5432");
  });
});
